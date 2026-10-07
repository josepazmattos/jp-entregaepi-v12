#!/usr/bin/env python3
"""Run the release EXE on an otherwise clean Windows CI account, without a USB reader.

Only the installer writes application registry entries. Cleanup compares their
exact ownership before deleting them and stops agents exclusively through the
authenticated loopback control protocol. It never kills a process by PID/name.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import socket
import stat
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

from biometria_release import AGENT_VERSION, EXECUTABLE, ReleaseError, verify_release

if os.name == "nt":
    import winreg
else:
    winreg = None

PORTS = range(8789, 8800)
PROTOCOL = r"Software\Classes\jpbiometria"
RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"
RUN_VALUE = "JPBiometria"
REPORT = Path(__file__).resolve().parent.parent / ".deploy" / "windows-biometria-report.json"
MAX_JSON = 32768
REPARSE_POINT = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)


class SmokeError(Exception):
    """Only constant, public messages belong in this exception or the report."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code

    def public(self) -> dict:
        return {"code": self.code, "message": str(self)}


def require(condition: bool, code: str, message: str) -> None:
    if not condition:
        raise SmokeError(code, message)


def ordinary_path(path: Path, *, directory: bool = False) -> os.stat_result:
    info = path.lstat()
    require(not stat.S_ISLNK(info.st_mode) and not getattr(info, "st_file_attributes", 0) & REPARSE_POINT,
            "UNSAFE_PATH", "A pasta de teste contém um link ou ponto de redirecionamento inesperado.")
    require(stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode),
            "UNSAFE_PATH", "Um arquivo ou uma pasta do teste foi substituído inesperadamente.")
    return info


def base64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def read_test_key(path: Path) -> bytes:
    info = ordinary_path(path)
    require(43 <= info.st_size <= 128, "CONTROL_KEY_INVALID", "A chave de controle criada pelo instalador é inválida.")
    encoded = path.read_bytes().strip()
    require(re.fullmatch(rb"[A-Za-z0-9_-]{43}", encoded) is not None,
            "CONTROL_KEY_INVALID", "A chave de controle criada pelo instalador é inválida.")
    decoded = base64.urlsafe_b64decode(encoded + b"=")
    require(len(decoded) == 32 and base64url(decoded).encode("ascii") == encoded,
            "CONTROL_KEY_INVALID", "A chave de controle criada pelo instalador é inválida.")
    return decoded


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        return None


class LocalControl:
    def __init__(self, key: bytes):
        self.key = key
        # Never inherit HTTP_PROXY, system proxy configuration or redirect targets.
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())

    def mac(self, value: str) -> str:
        return base64url(hmac.new(self.key, value.encode("utf-8"), hashlib.sha256).digest())

    def json(self, port: int, path: str, *, payload: bytes | None = None,
             headers: dict | None = None, limit: int = MAX_JSON) -> tuple[int, dict]:
        require(type(port) is int and port in PORTS and path in ("/control", "/status"),
                "LOCAL_TARGET_INVALID", "O destino solicitado está fora do contrato local do teste.")
        request = urllib.request.Request(
            f"http://127.0.0.1:{port}{path}", data=payload,
            method="POST" if payload is not None else "GET",
            headers={"Accept": "application/json", "Connection": "close", **(headers or {})},
        )
        try:
            try:
                response = self.opener.open(request, timeout=0.8)
            except urllib.error.HTTPError as error:
                response = error
            with response:
                code = response.code
                data = response.read(limit + 1)
        except (OSError, urllib.error.URLError, ValueError):
            raise SmokeError("LOCAL_UNREACHABLE", "A instância local não respondeu dentro do prazo.") from None
        require(len(data) <= limit, "LOCAL_JSON_INVALID", "A resposta local excedeu o limite do teste.")
        try:
            result = json.loads(data)
        except (ValueError, UnicodeError):
            raise SmokeError("LOCAL_JSON_INVALID", "A resposta local não contém JSON válido.") from None
        require(isinstance(result, dict), "LOCAL_JSON_INVALID", "A resposta local não contém um objeto JSON.")
        return code, result

    def command(self, port: int, command: str) -> dict:
        require(command in ("ping", "shutdown"), "CONTROL_COMMAND_INVALID", "Comando de controle não permitido.")
        stamp, nonce = str(int(time.time())), base64url(secrets.token_bytes(16))
        payload = json.dumps({"command": command}, separators=(",", ":"))
        signature = self.mac(f"/control\n{stamp}\n{nonce}\n{payload}")
        code, response = self.json(port, "/control", payload=payload.encode("ascii"), limit=8192,
                                   headers={"Content-Type": "application/json",
                                            "X-JP-Control": f"v1:{stamp}:{nonce}:{signature}"})
        if code == 409 and response.get("errorCode") == "READER_BUSY":
            raise SmokeError("CONTROL_BUSY", "A instância ainda está verificando o SDK; a parada segura foi adiada.")
        fields = {name: response.get(name) for name in ("instanceId", "version", "buildSha", "proof")}
        require(code == 200 and response.get("ok") is True and response.get("owned") is True
                and type(response.get("port")) is int and response["port"] == port
                and all(isinstance(value, str) for value in fields.values())
                and re.fullmatch(r"[A-Za-z0-9_-]{16,128}", fields["instanceId"]) is not None
                and re.fullmatch(r"[A-Za-z0-9._+-]{1,32}", fields["version"]) is not None
                and re.fullmatch(r"[0-9a-f]{40}", fields["buildSha"]) is not None
                and re.fullmatch(r"[A-Za-z0-9_-]{43}", fields["proof"]) is not None,
                "CONTROL_NOT_OWNED", "O serviço não comprovou pertencer à instalação temporária do teste.")
        expected = self.mac(f"response\n{stamp}\n{nonce}\n{command}\n{fields['instanceId']}\n"
                            f"{fields['version']}\n{port}\n{fields['buildSha']}")
        require(hmac.compare_digest(expected, fields["proof"]), "CONTROL_PROOF_INVALID",
                "A prova HMAC da instância não corresponde à chave privada deste teste.")
        return {name: response[name] for name in ("instanceId", "version", "buildSha", "port")}

    def owned(self) -> list[dict]:
        found = []
        for port in PORTS:
            try:
                found.append(self.command(port, "ping"))
            except SmokeError:
                # Foreign, legacy and non-HTTP listeners are never shutdown targets.
                continue
        return found


def reg_access(access: int) -> int:
    return access | winreg.KEY_WOW64_64KEY


def protocol_exists() -> bool:
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, PROTOCOL, 0, reg_access(winreg.KEY_READ)):
            return True
    except FileNotFoundError:
        return False


def run_value() -> tuple | None:
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY, 0, reg_access(winreg.KEY_QUERY_VALUE)) as key:
            value, kind = winreg.QueryValueEx(key, RUN_VALUE)
            return kind, value
    except FileNotFoundError:
        return None


def protocol_tree() -> dict | None:
    """Keep exact registry data private; only comparison results enter the report."""
    if not protocol_exists():
        return None
    result = {}

    def visit(relative: str, depth: int = 0) -> None:
        require(depth <= 4 and len(result) < 8, "REGISTRY_CHANGED",
                "O protocolo contém dados inesperados; nenhuma remoção automática foi autorizada.")
        path = PROTOCOL + ("\\" + relative if relative else "")
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, path, 0, reg_access(winreg.KEY_READ)) as key:
            subkeys, values, _ = winreg.QueryInfoKey(key)
            require(subkeys <= 4 and values <= 4, "REGISTRY_CHANGED",
                    "O protocolo contém dados inesperados; nenhuma remoção automática foi autorizada.")
            result[relative.casefold()] = {}
            for index in range(values):
                name, value, kind = winreg.EnumValue(key, index)
                result[relative.casefold()][name.casefold()] = (kind, value)
            children = [winreg.EnumKey(key, index) for index in range(subkeys)]
        for child in children:
            visit(relative + "\\" + child if relative else child, depth + 1)

    visit("")
    return result


def expected_registry(executable: Path) -> tuple[dict, tuple]:
    return ({
        "": {"": (winreg.REG_SZ, "URL:JP Biometria Protocol"), "url protocol": (winreg.REG_SZ, "")},
        "shell": {},
        r"shell\open": {},
        r"shell\open\command": {"": (winreg.REG_SZ, f'"{executable}" --start "%1"')},
    }, (winreg.REG_SZ, f'"{executable}" --start'))


def require_empty_registry() -> None:
    require(not protocol_exists() and run_value() is None, "REGISTRY_ALREADY_PRESENT",
            "O protocolo JP Biometria ou sua inicialização automática já existe. O teste foi recusado sem alterá-los.")


def port_open(port: int) -> bool:
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.15):
            return True
    except OSError:
        return False


class WindowsSmoke:
    def __init__(self, source: Path, commit: str):
        self.source, self.commit = source, commit
        self.report = {"version": AGENT_VERSION, "buildSha": commit if re.fullmatch(r"[0-9a-f]{40}", commit) else None,
                       "installerSha": None, "status": "failed", "checks": {}, "physicalReaderTested": False}
        self.root: Path | None = None
        self.root_identity: tuple | None = None
        self.install_dir: Path | None = None
        self.executable: Path | None = None
        self.environment: dict | None = None
        self.control: LocalControl | None = None
        self.processes: list[subprocess.Popen] = []
        self.known_ports: set[int] = set()
        self.install_attempted = False
        self.registry_confirmed = False

    def passed(self, name: str) -> None:
        self.report["checks"][name] = True

    def adopt_key(self) -> None:
        require(self.install_dir is not None, "CONTROL_KEY_UNAVAILABLE", "A instalação temporária não foi criada.")
        key = read_test_key(self.install_dir / "control.key")
        if self.control is None:
            self.control = LocalControl(key)
        else:
            require(hmac.compare_digest(key, self.control.key), "CONTROL_KEY_CHANGED",
                    "A chave de controle mudou durante o reparo; a nova chave não será usada para parar processos.")

    def launch(self, executable: Path, args: list[str], *, quiet: bool) -> dict | None:
        # A timeout intentionally does not call kill()/terminate(). Cleanup uses HMAC only.
        process = subprocess.Popen([str(executable), *args], env=self.environment, shell=False,
                                   stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                   creationflags=subprocess.CREATE_NO_WINDOW)
        self.processes.append(process)
        deadline = time.monotonic() + 90
        while True:
            try:
                output, _ = process.communicate(timeout=0.25)
                break
            except subprocess.TimeoutExpired as error:
                require(len(error.output or b"") <= MAX_JSON, "INSTALLER_OUTPUT_INVALID",
                        "A saída do instalador excedeu o contrato de diagnóstico.")
                require(time.monotonic() < deadline, "INSTALLER_TIMEOUT",
                        "O inicializador não terminou em 90 segundos. Nenhum processo foi encerrado à força.")
        require(len(output) <= MAX_JSON, "INSTALLER_OUTPUT_INVALID", "A saída do instalador excedeu o contrato de diagnóstico.")
        if process.returncode != 0:
            # Classify only fixed launcher messages; never persist paths or raw output.
            try:
                message = str(json.loads(output).get("message", ""))
            except (ValueError, UnicodeError, AttributeError):
                message = ""
            categories = {
                "Não foi possível gravar o agente Java": "JAVA_AGENT_FILE_UPDATE",
                "Não foi possível atualizar o inicializador": "LAUNCHER_FILE_UPDATE",
                "O agente não aceitou a parada segura": "SAFE_STOP_REJECTED",
                "O agente não concluiu a parada": "SAFE_STOP_TIMEOUT",
                "O agente encerrou antes": "AGENT_EARLY_EXIT",
                "O agente não confirmou a inicialização": "AGENT_START_TIMEOUT",
                "O processo do agente não iniciou": "AGENT_PROCESS_FAILED",
                "Não foi possível proteger": "DIRECTORY_PROTECTION_FAILED",
                "Não foi possível registrar": "REGISTRATION_FAILED",
            }
            self.report["installerFailureKind"] = next((code for prefix, code in categories.items() if prefix in message), "UNCLASSIFIED")
            print("Installer failure category: " + self.report["installerFailureKind"])
        require(process.returncode == 0, "INSTALLER_FAILED", "O executável Windows retornou falha ao instalar ou iniciar a ponte.")
        if not quiet:
            return None
        try:
            result = json.loads(output)
        except (ValueError, UnicodeError):
            raise SmokeError("INSTALLER_JSON_INVALID", "O instalador silencioso não devolveu JSON válido.") from None
        require(isinstance(result, dict) and result.get("ok") is True and result.get("version") == AGENT_VERSION
                and result.get("buildSha") == self.commit and type(result.get("port")) is int and result["port"] in PORTS,
                "INSTALLER_CONTRACT_INVALID", "O instalador silencioso não confirmou a versão, o commit e a porta esperados.")
        self.known_ports.add(result["port"])
        return result

    def assert_registry(self) -> None:
        tree, autorun = expected_registry(self.executable)
        require(protocol_tree() == tree and run_value() == autorun, "REGISTRY_CONTRACT_INVALID",
                "O protocolo ou a inicialização automática não corresponde ao executável temporário esperado.")
        self.registry_confirmed = True

    def one_instance(self, port: int) -> dict:
        instances = self.control.owned()
        require(len(instances) == 1 and instances[0]["port"] == port, "INSTANCE_COUNT_INVALID",
                "O teste não encontrou exatamente uma instância autenticada na porta confirmada pelo instalador.")
        own = instances[0]
        require(own["version"] == AGENT_VERSION and own["buildSha"] == self.commit,
                "INSTANCE_RELEASE_INVALID", "A instância autenticada não corresponde à versão e ao commit verificados.")
        self.known_ports.add(port)
        return own

    def status_without_sdk(self, own: dict) -> None:
        deadline = time.monotonic() + 15
        while True:
            code, result = self.control.json(own["port"], "/status")
            require(code == 200 and all(result.get(name) == own[name] for name in ("instanceId", "version", "buildSha", "port")),
                    "STATUS_INSTANCE_INVALID", "O status não corresponde à instância autenticada deste teste.")
            require(result.get("ok") is False and result.get("sdk") is False and result.get("reader") is False
                    and type(result.get("deviceCount")) is int and result["deviceCount"] == 0,
                    "UNEXPECTED_READER_READY", "O ambiente sem SDK informou leitor pronto ou um dispositivo inesperado.")
            if result.get("checking") is False and result.get("errorCode") != "INITIALIZING":
                break
            require(time.monotonic() < deadline, "SDK_DIAGNOSTIC_TIMEOUT", "O diagnóstico de SDK ausente não terminou no prazo.")
            time.sleep(0.2)
        capabilities = result.get("capabilities")
        allowed_codes = {"SDK_NOT_FOUND", "SDK_DLL_NOT_FOUND", "SDK_ARCH_MISMATCH", "SDK_LOAD_FAILED", "SDK_STATUS_FAILED", "JAVA_NOT_FOUND", "JAVA_ARCH_MISMATCH", "READER_NOT_FOUND", "WINDOWS_REQUIRED", "INITIALIZING"}
        observed = {
            "javaService": result.get("service") == "JP Biometria Local Java",
            "expectedAgent": result.get("agent") == "JPBiometria",
            "diagnosticOnly": result.get("runtime") == "diagnostic-only",
            "errorCode": result.get("errorCode") if result.get("errorCode") in allowed_codes else "UNEXPECTED",
            "busy": result.get("busy") is True,
            "checking": result.get("checking") is True,
            "capture": capabilities.get("capture") is True if isinstance(capabilities, dict) else False,
            "captureContract": isinstance(capabilities, dict) and capabilities.get("captureMethod") == "POST" and capabilities.get("capturePath") == "/api/capture",
            "templatesSupported": isinstance(capabilities, dict) and capabilities.get("templates") is True,
            "verifySupported": isinstance(capabilities, dict) and capabilities.get("verify") is True,
        }
        self.report["observedSDKStatus"] = observed
        print("SDK status contract: " + json.dumps(observed, sort_keys=True))
        require(result.get("service") == "JP Biometria Local Java" and result.get("agent") == "JPBiometria"
                and result.get("runtime") != "diagnostic-only" and result.get("errorCode") == "SDK_NOT_FOUND"
                and result.get("busy") is False and isinstance(capabilities, dict)
                and capabilities.get("capture") is True and capabilities.get("captureMethod") == "POST"
                # Capabilities describe the installed protocol, not device readiness.
                # The checks above still require ok/sdk/reader=False without the SDK.
                and capabilities.get("capturePath") == "/api/capture" and capabilities.get("templates") is True
                and capabilities.get("verify") is True,
                "SDK_DIAGNOSTIC_INVALID", "O agente Java não confirmou o diagnóstico esperado de SDK NITGEN ausente.")
        require(self.control.command(own["port"], "ping") == own, "STATUS_INSTANCE_CHANGED",
                "A instância mudou durante a conferência de seu status.")
        # Only this fixed projection is public; no native message, environment or raw body is saved.
        self.report["agentStatus"] = {"runtime": "java", "errorCode": "SDK_NOT_FOUND", "sdk": False,
                                      "reader": False, "deviceCount": 0, "checking": False}

    def verify_installed_hash(self, manifest: dict) -> None:
        info = ordinary_path(self.executable)
        require(info.st_size == manifest["sizeBytes"]
                and hashlib.sha256(self.executable.read_bytes()).hexdigest() == manifest["sha256"],
                "INSTALLED_HASH_INVALID", "O executável instalado diverge do artefato Windows verificado.")

    def run(self) -> None:
        require(os.name == "nt" and winreg is not None, "WINDOWS_REQUIRED", "Este teste executa o instalador somente no Windows.")
        manifest = verify_release(self.source, self.commit)
        self.report["installerSha"] = manifest["sha256"]
        self.passed("releaseArtifactVerified")
        require_empty_registry()
        self.passed("registryInitiallyAbsent")
        self.root = Path(tempfile.mkdtemp(prefix="JP Biometria Windows Smoke ")).resolve()
        info = ordinary_path(self.root, directory=True)
        self.root_identity = info.st_dev, info.st_ino
        local_appdata = self.root / "Local App Data"
        local_appdata.mkdir()
        self.install_dir = local_appdata / "JP" / "Biometria"
        self.executable = self.install_dir / "JPBiometria.exe"
        require(" " in str(local_appdata) and not self.install_dir.exists(), "ISOLATION_INVALID",
                "Não foi possível preparar uma instalação temporária isolada com espaços no caminho.")
        self.environment = {name: value for name, value in os.environ.items() if name.casefold() != "localappdata"}
        self.environment["LOCALAPPDATA"] = str(local_appdata)
        self.passed("isolatedLocalAppDataWithSpaces")
        # Recheck immediately before the first mutating executable invocation.
        require_empty_registry()
        self.install_attempted = True
        first_result = self.launch(self.source / EXECUTABLE, ["--install-quiet"], quiet=True)
        self.passed("quietInstallCompleted")
        self.adopt_key()
        self.passed("privateControlKeyCreated")
        self.verify_installed_hash(manifest)
        self.passed("installedExecutableMatchesArtifact")
        self.assert_registry()
        self.passed("urlProtocolRegistered")
        self.passed("autorunRegistered")
        first = self.one_instance(first_result["port"])
        self.passed("authenticatedControlPing")
        self.status_without_sdk(first)
        self.passed("javaAgentRunsWithoutSDK")
        self.passed("readerNeverReportedReady")
        self.assert_registry()
        self.launch(self.executable, ["--start", "jpbiometria://start"], quiet=False)
        reused = self.one_instance(first["port"])
        require(reused == first, "START_DID_NOT_REUSE", "A abertura pelo protocolo não reaproveitou a mesma instância autenticada.")
        self.passed("startReusedAuthenticatedInstance")
        self.passed("oneInstanceAfterStart")
        self.status_without_sdk(reused)
        # Reproduce SDK installation after agent startup, at a nonstandard path.
        # Only a synthetic PE header is used: no vendor SDK or biometric capture.
        previous_environment = self.environment.copy()
        program_files = self.root / "Program Files fixture"
        sdk = program_files / "Vendor Tools" / "NITGEN" / "eNBSP Custom Version" / "SDK"
        (sdk / "Lib").mkdir(parents=True)
        (sdk / "Lib" / "NBioBSPJNI.jar").write_bytes(b"synthetic jar; cannot capture")
        (sdk / "Bin" / "x64").mkdir(parents=True)
        pe = bytearray(512)
        pe[:2] = b"MZ"
        pe[0x3c:0x40] = (0x80).to_bytes(4, "little")
        pe[0x80:0x84] = b"PE\0\0"
        pe[0x84:0x86] = (0x8664).to_bytes(2, "little")
        for filename in ("NBioBSP.dll", "NBioBSPJNI.dll"):
            (sdk / "Bin" / "x64" / filename).write_bytes(pe)
        overrides = {"programfiles", "programfiles(x86)", "programw6432", "jp_biometria_sdk"}
        self.environment = {key: value for key, value in self.environment.items() if key.casefold() not in overrides}
        for key in ("ProgramFiles", "ProgramFiles(x86)", "ProgramW6432"):
            self.environment[key] = str(program_files)
        self.launch(self.executable, ["--start", "jpbiometria://start"], quiet=False)
        refreshed = self.one_instance(first["port"])
        require(refreshed["instanceId"] != first["instanceId"], "SDK_REFRESH_DID_NOT_RESTART",
                "O protocolo não refez a descoberta após a instalação do SDK.")
        deadline = time.monotonic() + 12
        while True:
            code, result = self.control.json(refreshed["port"], "/status")
            if result.get("checking") is False and result.get("errorCode") != "INITIALIZING":
                break
            require(time.monotonic() < deadline, "SDK_REFRESH_TIMEOUT", "A nova verificação não concluiu.")
            time.sleep(0.1)
        require(code == 200 and result.get("errorCode") == "SDK_LOAD_FAILED" and result.get("reader") is False,
                "NONSTANDARD_SDK_NOT_FOUND", "O SDK sintético fora da pasta padrão não chegou à validação nativa.")
        self.passed("nonstandardSDKFoundAfterStartup")
        self.passed("protocolRefreshesChangedRuntime")
        self.passed("syntheticDLLNeverReportsPhysicalReader")
        self.environment = previous_environment
        # Do not repair over a concurrent registry change or a replaced release/key.
        self.assert_registry()
        self.adopt_key()
        verify_release(self.source, self.commit)
        second_result = self.launch(self.source / EXECUTABLE, ["--install-quiet"], quiet=True)
        self.passed("quietRepairCompleted")
        self.adopt_key()
        self.passed("controlKeyPreservedOnRepair")
        self.verify_installed_hash(manifest)
        self.passed("repairedExecutableMatchesArtifact")
        self.assert_registry()
        second = self.one_instance(second_result["port"])
        require(second["instanceId"] != first["instanceId"], "REPAIR_DID_NOT_RESTART",
                "O reparo não substituiu a instância anterior por uma nova instância autenticada.")
        self.passed("repairCreatedNewInstance")
        self.passed("oneInstanceAfterRepair")
        self.status_without_sdk(second)
        self.passed("repairedJavaAgentRunsWithoutSDK")

    def stop_authenticated_agents(self) -> None:
        if self.control is None:
            return
        for own in self.control.owned():
            self.known_ports.add(own["port"])
            deadline = time.monotonic() + 8
            while True:
                try:
                    current = self.control.command(own["port"], "ping")
                    require(current == own, "CLEANUP_INSTANCE_CHANGED", "A instância mudou antes da parada autenticada.")
                    stopped = self.control.command(own["port"], "shutdown")
                    require(stopped == own, "CLEANUP_INSTANCE_CHANGED", "A resposta de parada pertence a outra instância.")
                    self.passed("authenticatedControlShutdown")
                    break
                except SmokeError as error:
                    if error.code != "CONTROL_BUSY" or time.monotonic() >= deadline:
                        raise
                    time.sleep(0.2)
            while port_open(own["port"]) and time.monotonic() < deadline:
                time.sleep(0.15)
            require(not port_open(own["port"]), "CLEANUP_AGENT_STILL_RUNNING",
                    "A instância não concluiu a parada autenticada; nenhum processo foi encerrado à força.")
        require(not self.control.owned() and not any(port_open(port) for port in self.known_ports),
                "CLEANUP_AGENT_UNCONFIRMED", "Ainda há uma instância ou porta do teste sem confirmação de parada segura.")

    def clean_registry(self) -> None:
        expected, autorun = expected_registry(self.executable)
        actual_tree, actual_run = protocol_tree(), run_value()
        if actual_tree is None and actual_run is None and not self.registry_confirmed:
            return
        # An interrupted first registration can leave one complete, owned entry.
        # Partial protocol trees without the unique executable path are not ours to delete.
        require((actual_tree == expected and actual_run == autorun) or
                (not self.registry_confirmed and actual_tree in (None, expected) and actual_run in (None, autorun)),
                "CLEANUP_REGISTRY_CHANGED", "O registro foi alterado ou ficou incompleto; dados sem propriedade comprovada foram preservados.")
        if actual_run is not None:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY, 0,
                                reg_access(winreg.KEY_QUERY_VALUE | winreg.KEY_SET_VALUE)) as key:
                value, kind = winreg.QueryValueEx(key, RUN_VALUE)
                require((kind, value) == autorun and protocol_tree() == actual_tree,
                        "CLEANUP_REGISTRY_CHANGED", "O registro mudou antes da limpeza; o valor concorrente foi preservado.")
                winreg.DeleteValue(key, RUN_VALUE)
        if actual_tree is not None:
            remaining = dict(expected)
            for relative in sorted(expected, key=lambda name: (name.count("\\"), len(name)), reverse=True):
                require(protocol_tree() == remaining and run_value() is None, "CLEANUP_REGISTRY_CHANGED",
                        "O registro mudou durante a limpeza; as entradas restantes foram preservadas.")
                path = PROTOCOL + ("\\" + relative if relative else "")
                winreg.DeleteKeyEx(winreg.HKEY_CURRENT_USER, path, access=winreg.KEY_WOW64_64KEY)
                del remaining[relative]
        require(not protocol_exists() and run_value() is None, "CLEANUP_REGISTRY_CHANGED",
                "As entradas temporárias do teste não puderam ser removidas com segurança.")

    def remove_temporary_tree(self) -> None:
        info = ordinary_path(self.root, directory=True)
        require((info.st_dev, info.st_ino) == self.root_identity, "CLEANUP_DIRECTORY_CHANGED",
                "A pasta temporária foi substituída; ela foi preservada.")
        for root, directories, files in os.walk(self.root, followlinks=False):
            for name in directories:
                ordinary_path(Path(root) / name, directory=True)
            for name in files:
                ordinary_path(Path(root) / name)
        shutil.rmtree(self.root)
        require(not self.root.exists(), "CLEANUP_DIRECTORY_FAILED", "A pasta temporária não foi completamente removida.")

    def cleanup(self) -> list[dict]:
        errors = []
        if self.root is None:
            return errors
        # A launcher still running could recreate files/registry after cleanup.
        # Leave them intact in that case; never terminate the launcher by PID.
        if any(process.poll() is None for process in self.processes):
            deadline = time.monotonic() + 5
            while any(process.poll() is None for process in self.processes) and time.monotonic() < deadline:
                time.sleep(0.2)
        launchers_finished = all(process.poll() is not None for process in self.processes)
        agents_stopped = False
        registry_removed = not self.install_attempted
        try:
            if self.install_attempted and self.control is None and (self.install_dir / "control.key").exists():
                self.adopt_key()
            self.stop_authenticated_agents()
            agents_stopped = True
            self.passed("cleanupAuthenticatedAgentsStopped")
        except (SmokeError, OSError):
            errors.append({"code": "CLEANUP_AGENT_FAILED", "message": "A parada autenticada não pôde ser comprovada; arquivos do teste foram preservados."})
        if not launchers_finished:
            errors.append({"code": "CLEANUP_LAUNCHER_ACTIVE", "message": "Um inicializador continua ativo; registro e pasta foram preservados, sem encerramento forçado."})
        if launchers_finished and self.install_attempted:
            try:
                self.clean_registry()
                registry_removed = True
                self.passed("cleanupRegistryRemoved")
            except (SmokeError, OSError):
                errors.append({"code": "CLEANUP_REGISTRY_FAILED", "message": "A propriedade do registro mudou ou não pôde ser comprovada; entradas não confirmadas foram preservadas."})
        if launchers_finished and agents_stopped and registry_removed:
            try:
                self.remove_temporary_tree()
                self.passed("cleanupTemporaryDirectoryRemoved")
            except (SmokeError, OSError):
                errors.append({"code": "CLEANUP_DIRECTORY_FAILED", "message": "A pasta temporária não pôde ser removida com segurança."})
        return errors


def write_report(report: dict) -> None:
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    ordinary_path(REPORT.parent, directory=True)
    require(not REPORT.is_symlink(), "REPORT_UNSAFE", "O destino do relatório não é seguro.")
    temporary = REPORT.with_suffix(".json.preparing")
    require(not temporary.exists() and not temporary.is_symlink(), "REPORT_UNSAFE", "O destino temporário do relatório já está ocupado.")
    try:
        with temporary.open("x", encoding="utf-8") as output:
            json.dump(report, output, ensure_ascii=False, indent=2)
            output.write("\n")
        temporary.replace(REPORT)
    finally:
        temporary.unlink(missing_ok=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--commit", required=True)
    args = parser.parse_args()
    smoke = WindowsSmoke(args.source.resolve(), args.commit)
    failure = None
    try:
        smoke.run()
    except SmokeError as error:
        failure = error.public()
    except ReleaseError:
        failure = {"code": "RELEASE_INVALID", "message": "O artefato Windows não passou na verificação de versão, commit, PE64 e SHA-256."}
    except KeyboardInterrupt:
        failure = {"code": "TEST_INTERRUPTED", "message": "O teste foi interrompido; a limpeza segura será verificada."}
    except Exception:
        failure = {"code": "WINDOWS_SMOKE_FAILED", "message": "O teste Windows não pôde concluir uma operação. Nenhum detalhe privado foi registrado."}
    finally:
        try:
            cleanup_errors = smoke.cleanup()
        except Exception:
            cleanup_errors = [{"code": "CLEANUP_FAILED", "message": "A limpeza segura não pôde ser concluída; nenhum processo foi encerrado à força."}]
    if failure:
        smoke.report["error"] = failure
    if cleanup_errors:
        smoke.report["cleanupErrors"] = cleanup_errors
    smoke.report["status"] = "success" if not failure and not cleanup_errors else "failed"
    try:
        write_report(smoke.report)
    except Exception:
        print("WINDOWS_SMOKE_REPORT_FAILED: Não foi possível gravar o relatório público do teste.", file=sys.stderr)
        return 1
    if smoke.report["status"] == "failed":
        error = failure or cleanup_errors[0]
        print(f"{error['code']}: {error['message']}", file=sys.stderr)
        return 1
    print("Windows installer, protocol, reuse, repair and authenticated cleanup passed. Physical USB reader: not tested.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
