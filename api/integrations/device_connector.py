"""
device_connector.py - Unified terminal and array connector layer.
Abstracts simulated networks, SSH sessions, and desktop shells.
"""
from abc import ABC, abstractmethod
import os
import subprocess
import sys

class DeviceConnector(ABC):
    @abstractmethod
    def connect(self) -> bool:
        pass

    @abstractmethod
    def execute(self, cmd: str) -> dict:
        """
        Executes a command and returns standard structure:
        {"stdout": str, "stderr": str, "exit_code": int}
        """
        pass

    @abstractmethod
    def disconnect(self):
        pass


class SimulatorConnector(DeviceConnector):
    def __init__(self, virtual_network, ip: str):
        self.vn = virtual_network
        self.ip = ip

    def connect(self) -> bool:
        return True

    def execute(self, cmd: str) -> dict:
        try:
            output = self.vn.execute(self.ip, cmd)
            return {"stdout": output, "stderr": "", "exit_code": 0}
        except Exception as e:
            return {"stdout": "", "stderr": str(e), "exit_code": 1}

    def disconnect(self):
        pass


class SSHConnector(DeviceConnector):
    def __init__(self, host: str, username: str, password: str, port: int = 22, timeout: float = 10.0):
        self.host = host
        self.username = username
        self.password = password
        self.port = port
        self.timeout = timeout
        self.client = None

    def connect(self) -> bool:
        import paramiko
        try:
            self.client = paramiko.SSHClient()
            self.client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            self.client.connect(
                hostname=self.host,
                username=self.username,
                password=self.password,
                port=self.port,
                timeout=self.timeout
            )
            return True
        except Exception as e:
            sys.stderr.write(f"SSH Connection Failure to {self.host}: {e}\n")
            return False

    def execute(self, cmd: str) -> dict:
        if not self.client:
            return {"stdout": "", "stderr": "SSH Client not connected", "exit_code": -1}
        try:
            stdin, stdout, stderr = self.client.exec_command(cmd)
            out = stdout.read().decode('utf-8', errors='replace')
            err = stderr.read().decode('utf-8', errors='replace')
            return {"stdout": out, "stderr": err, "exit_code": stdout.channel.recv_exit_status()}
        except Exception as e:
            return {"stdout": "", "stderr": str(e), "exit_code": -1}

    def disconnect(self):
        if self.client:
            try:
                self.client.close()
            except:
                pass
            self.client = None
