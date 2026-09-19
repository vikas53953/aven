(function (root) {
  'use strict';

  function json(value) {
    return JSON.stringify(value === undefined ? null : value, null, 2);
  }

  function node(tag, className, text) {
    var element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function button(label, className, handler) {
    var control = node('button', className, label);
    control.type = 'button';
    control.addEventListener('click', handler);
    return control;
  }

  function detail(parent, label, value, code) {
    var row = node('div', 'workflow-detail');
    row.append(node('dt', '', label));
    var valueNode = node(code ? 'pre' : 'dd', code ? 'workflow-json' : '', code ? json(value) : String(value ?? 'Unavailable'));
    if (!code) valueNode.textContent = String(value ?? 'Unavailable');
    row.append(valueNode);
    parent.append(row);
  }

  function renderQuestion(container, card, options) {
    var question = card.question;
    var article = node('article', 'workflow-card pending-question-card');
    article.dataset.workflowCard = 'pending-question';
    article.setAttribute('aria-live', 'polite');
    article.append(node('p', 'workflow-kicker', 'Waiting for your answer'));
    article.append(node('h3', '', question.prompt));
    var form = node('form', 'workflow-question-form');
    var choiceName = 'workflow-choice-' + question.id;
    var selected = null;
    if (Array.isArray(question.choices) && question.choices.length) {
      var fieldset = node('fieldset', 'workflow-choices');
      fieldset.append(node('legend', '', 'Choose one'));
      question.choices.forEach(function (choice) {
        var label = node('label', 'workflow-choice');
        var radio = document.createElement('input');
        radio.type = 'radio'; radio.name = choiceName; radio.value = choice.id;
        radio.addEventListener('change', function () { selected = radio.value; });
        label.append(radio, node('span', '', choice.label)); fieldset.append(label);
      });
      form.append(fieldset);
    }
    var freeText = null;
    if (question.allowFreeText) {
      var label = node('label', 'workflow-free-text', 'Or answer in your own words');
      freeText = document.createElement('textarea');
      freeText.rows = 3; freeText.maxLength = 20000; freeText.placeholder = 'Add context if needed';
      label.append(freeText); form.append(label);
    }
    var status = node('p', 'workflow-status', '');
    var actions = node('div', 'workflow-actions');
    var answer = button('Answer', 'button-primary', function () {
      var text = freeText && freeText.value.trim();
      if ((selected ? 1 : 0) + (text ? 1 : 0) !== 1) { status.textContent = 'Choose one option or enter free text.'; return; }
      var answer = { questionId: question.id, token: options.token };
      if (selected) answer.choice = selected; else answer.text = text;
      options.onAnswer?.(answer);
    });
    var cancel = button('Cancel', 'button-secondary', function () {
      options.onCancel?.({ questionId: question.id, token: options.token });
    });
    if (!card.interactive) {
      answer.disabled = true; cancel.disabled = true;
      status.textContent = card.running ? (card.stopping ? 'Stopping the resumed run…' : 'Resuming with your answer…') : card.restored ? 'Restored review only. Release the waiting run before starting a fresh request.' : 'This question is no longer active.';
      if (card.running && options.onStop) {
        var stop = button(card.stopping ? 'Stopping…' : 'Stop', 'button-secondary', function () { options.onStop?.({ questionId: question.id }); });
        stop.disabled = !!card.stopping; actions.append(stop);
      } else if (card.restored) actions.append(button('Start fresh request', 'button-secondary', function () { options.onAbandon?.({ questionId: question.id }); }));
    }
    actions.append(answer, cancel); form.append(status, actions); article.append(form); container.replaceChildren(article);
    return article;
  }

  function renderReview(parent, receipt) {
    if (!receipt) return;
    var review = node('section', 'workflow-review');
    review.append(node('h4', '', 'Exact change review'));
    var list = node('dl', 'workflow-details');
    detail(list, 'Target', receipt.target, true);
    detail(list, 'Operation', receipt.operation, false);
    detail(list, 'Scope', receipt.scope, true);
    detail(list, 'Scope digest', receipt.scopeDigest, false);
    detail(list, 'Diff', receipt.diff, true);
    detail(list, 'Impact', receipt.impact, true);
    detail(list, 'Rollback limits', receipt.rollback, true);
    detail(list, 'Action digest', receipt.actionDigest, false);
    review.append(list);
    parent.append(review);
  }

  function renderApproval(container, card, options) {
    var approval = card.approval;
    var article = node('article', 'workflow-card execution-approval-card');
    article.dataset.workflowCard = 'execution-approval';
    article.append(node('p', 'workflow-kicker', approval.status === 'approved' ? 'Approved change' : 'Approval required'));
    article.append(node('h3', '', approval.status === 'approved' ? 'Approval recorded' : 'Review before any change'));
    renderReview(article, card.receipt);
    var status = node('p', 'workflow-status', '');
    var actions = node('div', 'workflow-actions');
    if (approval.status === 'approved') {
      status.textContent = 'Approved · mock execution only. No live provider or device write is implied.';
      article.append(status);
      if (card.executionAllowed) actions.append(button('Run approved mock', 'button-primary', function () { options.onExecute?.({ approvalId: approval.id, token: options.executionToken, actionDigest: approval.actionDigest, scope: card.receipt?.scope }); }));
    } else if (approval.status === 'pending' && card.interactive) {
      actions.append(button('Approve', 'button-primary', function () { options.onApprove?.({ approvalId: approval.id, token: options.token, actionDigest: approval.actionDigest, scope: card.receipt?.scope }); }));
      actions.append(button('Deny', 'button-danger', function () { options.onDeny?.({ approvalId: approval.id, token: options.token }); }));
      actions.append(button('Cancel', 'button-secondary', function () { options.onCancel?.({ approvalId: approval.id, token: options.token }); }));
    } else {
      status.textContent = card.restored ? 'Restored review only. Fresh approval is required; execution is unavailable.' : 'Approval is ' + approval.status + ' and cannot authorize execution.';
    }
    article.append(status, actions); container.replaceChildren(article);
    return article;
  }

  function renderProposal(container, card) {
    var article = node('article', 'workflow-card change-review-card');
    article.dataset.workflowCard = 'change-review';
    article.append(node('p', 'workflow-kicker', card.restored ? 'Restored review · fresh request required' : card.executionAllowed ? 'Proposed change · awaiting approval' : 'Plan preview · no tools'));
    article.append(node('h3', '', card.restored ? 'Review retained; request again to continue' : card.executionAllowed ? 'Review exact scope before approval' : 'Plan mode is read-only'));
    renderReview(article, card.receipt);
    article.append(node('p', 'workflow-status', card.restored ? 'Restored history cannot authorize an action.' : card.executionAllowed ? 'Nothing runs from this proposal preview.' : 'Plan mode cannot approve or execute a state-changing operation.'));
    container.replaceChildren(article);
    return article;
  }

  function render(container, card, options) {
    options = options || {};
    if (!container || !card) return null;
    if (card.type === 'pending-question-card') return renderQuestion(container, card, options);
    if (card.type === 'execution-approval-card') return renderApproval(container, card, options);
    if (card.type === 'change-review-card') return renderProposal(container, card, options);
    container.replaceChildren(node('p', 'workflow-status', 'Unsupported workflow card.'));
    return null;
  }

  // The host chat can persist this state with its conversation and render it
  // after reload. Rendering is pure; callbacks are only reached by a user
  // click on the resulting card.
  function renderConversationState(container, state, options) {
    options = options || {};
    if (!state) return null;
    var pending = state.pendingQuestion || state.pending_question;
    if (pending) {
      var question = pending.question || pending;
      var questionActive = !question.expiresAt || Date.now() < Number(question.expiresAt);
      return render(container, { type: 'pending-question-card', interactive: state.status === 'waiting-question' && questionActive, running: state.status === 'running', stopping: state.stopping === true, restored: state.status === 'restored-history', question: question }, {
        token: pending.token,
        onAnswer: options.onAnswer,
        onCancel: options.onCancel,
        onStop: options.onStop,
        onAbandon: options.onAbandon
      });
    }
    if (state.approval) {
      var approval = state.approval;
      var approvalActive = !approval.expiresAt || Date.now() < Number(approval.expiresAt);
      return render(container, { type: 'execution-approval-card', interactive: state.status === 'pending' && approvalActive, restored: state.status === 'restored-history', executionAllowed: approvalActive && (state.executionAllowed ?? (state.status === 'approved' && state.status !== 'restored-history')), approval: approval, receipt: state.receipt }, {
        token: state.token,
        executionToken: state.executionToken,
        onApprove: options.onApprove,
        onDeny: options.onDeny,
        onCancel: options.onCancel,
        onExecute: options.onExecute
      });
    }
    if (state.proposal && state.receipt) {
      return render(container, { type: 'change-review-card', restored: state.status === 'restored-history', executionAllowed: state.status === 'restored-history' ? false : state.executionAllowed ?? (state.proposal.status === 'proposed' && state.mode !== 'plan'), receipt: state.receipt }, options);
    }
    return null;
  }

  root.AvenApprovalWorkflow = Object.freeze({ render: render, renderQuestion: renderQuestion, renderProposal: renderProposal, renderApproval: renderApproval, renderConversationState: renderConversationState });
}(window));
