import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import network


class NetworkWorkerTests(unittest.TestCase):
    def request(self, known_hosts: Path, command: str = "show version"):
        return {
            "operation": "read",
            "profile": {
                "host": "192.0.2.10",
                "port": 22,
                "platform": "cisco_ios",
                "username": "sandbox",
                "knownHosts": str(known_hosts),
            },
            "command": command,
            "password": "secret-only-in-memory",
        }

    def test_nornir_dispatch_uses_strict_known_hosts_and_disconnects(self):
        with tempfile.TemporaryDirectory() as directory:
            known_hosts = Path(directory) / "known_hosts"
            known_hosts.write_text("192.0.2.10 ssh-ed25519 AAAA\n", encoding="utf-8")
            connection = Mock()
            connection.send_command.return_value = "sw1# show version\nVersion 17.1"
            with patch.object(network, "ConnectHandler", return_value=connection) as connect:
                response = network.main(self.request(known_hosts))

            self.assertEqual(response["ok"], True)
            self.assertEqual(response["output"], "sw1# show version\nVersion 17.1")
            self.assertEqual(response["transport"], "nornir-netmiko")
            connect.assert_called_once()
            kwargs = connect.call_args.kwargs
            self.assertEqual(kwargs["device_type"], "cisco_ios")
            self.assertEqual(kwargs["host"], "192.0.2.10")
            self.assertEqual(kwargs["password"], "secret-only-in-memory")
            self.assertTrue(kwargs["ssh_strict"])
            self.assertFalse(kwargs["system_host_keys"])
            self.assertTrue(kwargs["alt_host_keys"])
            self.assertEqual(kwargs["alt_key_file"], str(known_hosts))
            connection.send_command.assert_called_once_with("show version", read_timeout=20)
            connection.disconnect.assert_called_once_with()

    def test_catalog_is_read_only_and_unsupported_input_never_dispatches(self):
        expected = {
            "show version",
            "show ip interface brief",
            "show interfaces status",
            "show vlan brief",
            "show ip route",
            "show interfaces",
            "show interfaces description",
            "show ip bgp summary",
            "show ip bgp",
            "show ip ospf neighbor",
            "show ip route summary",
        }
        self.assertTrue(expected.issubset(network.COMMANDS["cisco_ios"]))
        self.assertEqual(len(network.COMMANDS["cisco_ios"]), 25)
        self.assertTrue(all(command.startswith("show ") for command in network.COMMANDS["cisco_ios"]))
        with tempfile.TemporaryDirectory() as directory:
            known_hosts = Path(directory) / "known_hosts"
            known_hosts.write_text("192.0.2.10 ssh-ed25519 AAAA\n", encoding="utf-8")
            with patch.object(network, "ConnectHandler") as connect:
                with self.assertRaises(RuntimeError):
                    network.main(self.request(known_hosts, "show running-config"))
                with self.assertRaises(RuntimeError):
                    network.main({"operation": "write", "profile": {}, "command": "reload", "password": "secret"})
            connect.assert_not_called()

    def test_postsubmission_failure_is_unknown_and_still_disconnects(self):
        with tempfile.TemporaryDirectory() as directory:
            known_hosts = Path(directory) / "known_hosts"
            known_hosts.write_text("192.0.2.10 ssh-ed25519 AAAA\n", encoding="utf-8")
            connection = Mock()
            connection.send_command.side_effect = RuntimeError("device error contains secret-only-in-memory")
            with patch.object(network, "ConnectHandler", return_value=connection):
                response = network.main(self.request(known_hosts))

            self.assertEqual(response, {
                "ok": False,
                "error": "network runtime action failed",
                "submitted": True,
                "status": "UNKNOWN",
                "transport": "nornir-netmiko",
            })
            self.assertNotIn("secret-only-in-memory", str(response))
            connection.disconnect.assert_called_once_with()

    def test_connection_failure_is_failed_before_submission(self):
        with tempfile.TemporaryDirectory() as directory:
            known_hosts = Path(directory) / "known_hosts"
            known_hosts.write_text("192.0.2.10 ssh-ed25519 AAAA\n", encoding="utf-8")
            with patch.object(network, "ConnectHandler", side_effect=RuntimeError("private detail")):
                response = network.main(self.request(known_hosts))

            self.assertEqual(response["ok"], False)
            self.assertEqual(response["submitted"], False)
            self.assertEqual(response["status"], "FAILED")
            self.assertNotIn("private detail", str(response))


if __name__ == "__main__":
    unittest.main()
