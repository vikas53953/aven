/* Bounded, session-only text attachment adapter for the polished chat shell. */
(() => {
  'use strict';

  const accepts = Object.freeze([
    '.txt', '.md', '.csv', '.json', '.log', '.yaml', '.yml', '.xml', '.ini', '.cfg', '.conf'
  ]);
  const limits = Object.freeze({
    maxFileBytes: 32 * 1024,
    maxAggregateBytes: 64 * 1024,
    maxRecords: 5,
    maxNameLength: 180
  });

  let idSequence = 0;

  function createId() {
    const randomUuid = globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : '';
    idSequence += 1;
    return `attachment-${Date.now().toString(36)}-${idSequence.toString(36)}${randomUuid ? `-${randomUuid}` : ''}`;
  }

  function displayName(file) {
    const value = typeof file?.name === 'string' ? file.name : '';
    return value ? value.slice(0, limits.maxNameLength) : 'Unnamed file';
  }

  function errorRecord(file, error, fingerprint = '') {
    const record = { id: createId(), name: displayName(file), status: 'error', error };
    // Keep the public rejected shape small while retaining the tuple for a later
    // readFiles call that receives the same in-memory chat records.
    if (fingerprint) Object.defineProperty(record, 'fingerprint', { value: fingerprint });
    return record;
  }

  function normalizeLastModified(file) {
    const value = file?.lastModified;
    if (value === undefined || value === null || value === '') return '';
    const number = Number(value);
    return Number.isFinite(number) ? number : String(value);
  }

  function fingerprintFor(file, name, size) {
    return JSON.stringify([
      name,
      size,
      normalizeLastModified(file),
      String(file?.type || '').toLowerCase()
    ]);
  }

  function fileSize(file) {
    const value = Number(file?.size);
    return Number.isInteger(value) && value >= 0 ? value : null;
  }

  function extensionFor(name) {
    const lower = name.toLowerCase();
    return accepts.find(extension => lower.endsWith(extension)) || '';
  }

  function validateName(file) {
    const raw = typeof file?.name === 'string' ? file.name : '';
    if (!raw) return 'A filename is required.';
    if (raw.length > limits.maxNameLength) return `Filename must be ${limits.maxNameLength} characters or fewer.`;
    if (/[<>]/u.test(raw)) return 'Filename must not contain HTML markup.';
    if (raw.includes('\u0000')) return 'Filename must not contain a NUL byte.';
    if (/^image\//iu.test(String(file?.type || ''))) {
      return 'File reading is not connected for image attachments. Choose a supported text file.';
    }
    if (!extensionFor(raw)) {
      return 'File reading is not connected for this type. Choose a supported text file.';
    }
    return '';
  }

  function bytesFrom(value) {
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) {
      return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    }
    return null;
  }

  function existingFingerprints(records) {
    return new Set(records
      .map(record => typeof record?.fingerprint === 'string' ? record.fingerprint : '')
      .filter(Boolean));
  }

  function readyBytes(records) {
    return records.reduce((sum, record) => {
      if (record?.status !== 'ready') return sum;
      const size = Number(record.size);
      return Number.isInteger(size) && size >= 0 ? sum + size : sum;
    }, 0);
  }

  async function readOne(file, currentReadyBytes, seenFingerprints) {
    const name = typeof file?.name === 'string' ? file.name : '';
    const size = fileSize(file);
    const fingerprint = size === null ? '' : fingerprintFor(file, name, size);
    if (fingerprint && seenFingerprints.has(fingerprint)) return { duplicate: true, fingerprint };
    const nameError = validateName(file);
    if (nameError) return { record: errorRecord(file, nameError, fingerprint), fingerprint };
    if (size === null) return {
      record: errorRecord(file, 'File size is unavailable or invalid.'),
      fingerprint: ''
    };

    if (size > limits.maxFileBytes) return {
      record: errorRecord(file, `File exceeds the ${limits.maxFileBytes / 1024} KiB per-file limit.`, fingerprint),
      fingerprint
    };
    if (currentReadyBytes + size > limits.maxAggregateBytes) return {
      record: errorRecord(file, `Ready attachment contents exceed the ${limits.maxAggregateBytes / 1024} KiB chat limit.`, fingerprint),
      fingerprint
    };
    if (typeof file?.arrayBuffer !== 'function') return {
      record: errorRecord(file, 'File reading is unavailable for this file.', fingerprint),
      fingerprint
    };

    let bytes;
    try {
      // The advertised File.size and aggregate limits are checked before this read.
      bytes = bytesFrom(await file.arrayBuffer());
    } catch {
      return { record: errorRecord(file, 'Could not read this file.', fingerprint), fingerprint };
    }
    if (!bytes) return { record: errorRecord(file, 'Could not read this file as bytes.', fingerprint), fingerprint };
    if (bytes.byteLength > limits.maxFileBytes) return {
      record: errorRecord(file, `File exceeds the ${limits.maxFileBytes / 1024} KiB per-file limit.`, fingerprint),
      fingerprint
    };
    if (bytes.byteLength !== size) return {
      record: errorRecord(file, 'File size changed while it was being read.', fingerprint),
      fingerprint
    };
    if (currentReadyBytes + bytes.byteLength > limits.maxAggregateBytes) return {
      record: errorRecord(file, `Ready attachment contents exceed the ${limits.maxAggregateBytes / 1024} KiB chat limit.`, fingerprint),
      fingerprint
    };
    if (bytes.includes(0)) return {
      record: errorRecord(file, 'NUL bytes are not allowed in text attachments.', fingerprint),
      fingerprint
    };

    let text;
    try {
      text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
      return {
        record: errorRecord(file, 'The file is not valid UTF-8 text.', fingerprint),
        fingerprint
      };
    }
    if (text.includes('\u0000')) return {
      record: errorRecord(file, 'NUL bytes are not allowed in text attachments.', fingerprint),
      fingerprint
    };
    return {
      record: {
        id: createId(),
        name,
        text,
        size: bytes.byteLength,
        status: 'ready',
        fingerprint
      },
      fingerprint,
      readyBytes: bytes.byteLength
    };
  }

  async function readFiles(files, existing = []) {
    const records = (Array.isArray(existing) ? existing : []).slice(0, limits.maxRecords);
    let aggregateReadyBytes = readyBytes(records);
    const seen = existingFingerprints(records);
    const incoming = files == null ? [] : Array.from(files);

    for (const file of incoming) {
      // Records, including rejected records, remain bounded for a single chat.
      if (records.length >= limits.maxRecords) break;
      const result = await readOne(file, aggregateReadyBytes, seen);
      if (result.duplicate) continue;
      records.push(result.record);
      if (result.fingerprint) seen.add(result.fingerprint);
      if (result.readyBytes) aggregateReadyBytes += result.readyBytes;
    }
    return records;
  }

  function compose(text, records = []) {
    if (!Array.isArray(records)) throw new Error('Attachment records must be an array.');
    const errors = records.filter(record => record?.status === 'error');
    if (errors.length) {
      const names = errors.map(record => record?.name || 'Unnamed file').join(', ');
      throw new Error(`Remove or replace rejected attachments before sending: ${names}.`);
    }
    const invalid = records.find(record => record?.status !== 'ready');
    if (invalid) throw new Error('Attachment records are invalid.');

    const prompt = typeof text === 'string' ? text : String(text ?? '');
    const names = records.map(record => String(record.name));
    const sections = records.map(record => {
      if (typeof record.name !== 'string' || typeof record.text !== 'string') {
        throw new Error('Attachment records are invalid.');
      }
      return [
        `--- BEGIN ATTACHMENT: ${record.name} ---`,
        record.text,
        `--- END ATTACHMENT: ${record.name} ---`
      ].join('\n');
    });
    return {
      text: sections.length ? `${prompt}${prompt ? '\n\n' : ''}${sections.join('\n\n')}` : prompt,
      names
    };
  }

  const api = Object.freeze({
    accepts,
    limits,
    MAX_FILE_BYTES: limits.maxFileBytes,
    MAX_AGGREGATE_BYTES: limits.maxAggregateBytes,
    MAX_RECORDS: limits.maxRecords,
    MAX_NAME_LENGTH: limits.maxNameLength,
    readFiles,
    compose
  });

  if (typeof module === 'object' && module && module.exports) module.exports = api;
  const browserGlobal = typeof window === 'object' && window ? window : globalThis;
  if (browserGlobal) browserGlobal.AvenAttachments = api;
  if (typeof globalThis === 'object' && globalThis && globalThis !== browserGlobal) globalThis.AvenAttachments = api;
})();
