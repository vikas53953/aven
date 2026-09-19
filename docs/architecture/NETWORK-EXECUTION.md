# Aven network execution layer

Selected stack: **Nornir + Netmiko**, replacing Itential as the planned default network execution framework.

## What runs where

Browser → Node chat API → LangChain/LangGraph → typed diagnostic tool → `network-execution.cjs`.

- Catalyst target: existing HTTPS Command Runner connector.
- SSH profile: existing `ExecutionAdapters.networkRead()` → Python stdin worker → Nornir task runner → Netmiko SSH → device.
- Results return with transport, command, target, timing and output. The LLM interprets bounded context; raw evidence remains available.

Nornir is a real task runner here, initially with one target per tool invocation. This is not yet fleet scheduling, a durable job service or customer isolation.

## Configure an SSH lab target

No SSH profiles existed at this checkpoint. A working Catalyst connection does not supply SSH credentials or network reachability.

1. Obtain the lab hostname/IP, platform, port and username. Establish required sandbox VPN access.
2. Verify the SSH host-key fingerprint from a trusted lab source. Put its verified entry in a `known_hosts` file inside this project. Never automatically trust a key merely because a host returned it.
3. Store the password locally with `node intentgraph/vault.cjs network-lab`. This prompts through stdin and stores a Windows DPAPI-protected credential. Do not put the password in the profile or chat.
4. Use the existing network profile configuration action or create `.intentgraph/runtime/adapters/profiles.json` with this schema, replacing example values:

```json
{"profiles":[{"id":"lab-sw1","host":"192.0.2.10","port":22,"platform":"cisco_ios","username":"LAB_USER","credentialRef":"network-lab","knownHosts":".intentgraph/runtime/adapters/known_hosts"}]}
```

`192.0.2.10` is a documentation address, not a working sandbox. Profile IDs are the names used in chat; use unique IDs that do not collide with Catalyst hostnames.

5. Ask “Check the BGP peers on lab-sw1.” Inspect the transport and evidence. Until this succeeds, the profile is configured, not verified connected.

## Capability scope

Both transports now use a shared catalog of 25 read-only operations, including interface state, routes, BGP/OSPF, ARP, MAC tables, CDP/LLDP, VLANs, trunks, spanning tree, EtherChannel, inventory, CPU and clock. The controller or device may reject an operation; catalog inclusion is not live support certification. The model receives each target's supported command list. Configuration writes and arbitrary shell commands are not connected in this slice.

The existing six-tool/120-second run bounds remain. The Python worker has a 30-second process timeout, strict host-key checks and no automatic retries. Timeout or cancellation after dispatch may leave the outcome unknown; stopping the local worker cannot retract a command already sent to a device.

## Dependencies and verification

Install the pinned network dependencies using the project interpreter:

```powershell
.\.intentgraph\runtime\python\Scripts\python.exe -m pip install -r intentgraph/adapters/requirements-network.txt
```

Python tests exercise real Nornir dispatch with a mocked device connection. They do not establish live SSH access. Existing Catalyst execution is verified separately. Diagnostic accuracy still requires domain evaluation; an execution framework cannot certify an LLM's conclusions.
