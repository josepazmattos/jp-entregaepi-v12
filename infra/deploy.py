#!/usr/bin/env python3
"""Deploy exclusivo da main. Usa AWS CLI; nunca imprime respostas sensíveis.

O pacote/configuração anterior da Lambda fica somente no runner, em .deploy/private.
S3 recebe apenas arquivos de frontend que já eram públicos e o manifesto desses arquivos.
"""
from __future__ import annotations

import base64
import dataclasses
import datetime as dt
import hashlib
import json
import mimetypes
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile

from fetch_ca_snapshot import read_source, verify_installed
from biometria_release import verify_release, ReleaseError, EXECUTABLE, MANIFEST
from complete_release import verify as verify_complete, FILENAME as COMPLETE_EXECUTABLE, MANIFEST as COMPLETE_MANIFEST

VERSION = "12.9.4"
REPOSITORY = "josepazmattos/jp-entregaepi-v12"
ACCOUNT = "003020057405"
REGION = "sa-east-1"
BUCKET = "pagina-conteudo-cloudfront"
PREFIX = "EntregaEPI"
DISTRIBUTION = "E2Q4EB4LP1LFXF"
FUNCTION = "jp-entregaepi-v12-api"
FUNCTION_ARN = f"arn:aws:lambda:{REGION}:{ACCOUNT}:function:{FUNCTION}"
DEPLOY_ROLE = "jp-entregaepi-v12-github-actions-role"
EXECUTION_ROLE = f"arn:aws:iam::{ACCOUNT}:role/jp-entregaepi-v12-lambda-role"
TABLE = "jp-entregaepi-v12"
API_ID = "g4pdu3t1va"
API_URL = f"https://{API_ID}.execute-api.{REGION}.amazonaws.com"
POOL = "sa-east-1_3FNCoTvr0"
CLIENT = "2q2inha617oeer4vb0m0hjoja0"
ISSUER = f"https://cognito-idp.{REGION}.amazonaws.com/{POOL}"
PUBLIC_URL = "https://www.jptreinamentos.com.br"
CACHE_CONTROL = "no-store, no-cache, must-revalidate"
PUBLIC_ROUTES = ("GET /health", "GET /api/caepi", "GET /api/caepi/{ca}",
                 "OPTIONS /", "OPTIONS /{proxy+}")
OBJECT_METADATA_FIELDS = ("ContentType", "CacheControl", "ContentDisposition",
                          "ContentEncoding", "ContentLanguage", "Expires", "Metadata",
                          "WebsiteRedirectLocation")
ALLOWED_AWS = {
    "sts": {"get-caller-identity"},
    "dynamodb": {"describe-table", "describe-time-to-live"},
    "cognito-idp": {"describe-user-pool", "describe-user-pool-client", "list-groups"},
    "lambda": {"get-function", "get-function-configuration", "update-function-code",
               "update-function-configuration"},
    "apigatewayv2": {"get-api", "get-routes", "get-integrations", "get-authorizers",
                     "get-stages", "create-authorizer", "update-authorizer",
                     "create-route", "update-route", "update-api"},
    "s3api": {"get-object", "put-object", "delete-object"},
    "cloudfront": {"create-invalidation", "get-invalidation"},
}


class DeployError(RuntimeError):
    """Mensagem deliberadamente segura para logs públicos."""


class AwsError(DeployError):
    def __init__(self, service: str, operation: str, code: str):
        self.code = code
        super().__init__(f"AWS {service}/{operation}: {code}; resposta detalhada omitida.")


def now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def sha256_b64(path: Path) -> str:
    return base64.b64encode(bytes.fromhex(sha256(path))).decode("ascii")


def save_json(path: Path, value: object, private: bool = True) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    path.chmod(0o600 if private else 0o644)


class AwsCli:
    def __init__(self, private_dir: Path):
        self.request_dir = private_dir / "requests"
        self.request_dir.mkdir(parents=True, exist_ok=True)
        self.request_dir.chmod(0o700)
        self.counter = 0

    def check_support(self) -> None:
        # Inspect the installed CLI schema without contacting AWS.
        requirements = {"put-object": {"IfMatch", "IfNoneMatch", "ChecksumSHA256"},
                        "delete-object": {"IfMatch"}}
        for operation, fields in requirements.items():
            try:
                answer = subprocess.run(["aws", "s3api", operation, "--generate-cli-skeleton", "input"],
                                        capture_output=True, text=True, timeout=20)
                schema = json.loads(answer.stdout) if answer.returncode == 0 else {}
            except (OSError, subprocess.TimeoutExpired, json.JSONDecodeError):
                schema = {}
            if not fields.issubset(schema):
                raise DeployError("A AWS CLI instalada não oferece as gravações condicionais exigidas. Atualize a CLI no runner.")

    def call(self, service: str, operation: str, params: dict | None = None,
             extra: tuple | list = ()) -> dict:
        if operation not in ALLOWED_AWS.get(service, set()):
            raise DeployError("Operação AWS fora do escopo da implantação.")
        params = params or {}
        self.counter += 1
        request_file = None
        command = ["aws", service, operation, "--region", REGION, "--output", "json",
                   "--no-cli-pager", "--no-cli-auto-prompt", "--cli-error-format", "legacy"]
        if (service, operation) == ("s3api", "get-object"):
            # Streaming output disables --cli-input-json in AWS CLI. Keep the
            # three public request values explicit and the output filename last.
            flags = {"Bucket": "--bucket", "Key": "--key",
                     "ExpectedBucketOwner": "--expected-bucket-owner"}
            if set(params) != set(flags) or len(extra) != 1 or any(
                    not isinstance(value, str) or not value for value in params.values()):
                raise DeployError("Parâmetros inesperados no download de backup S3.")
            for name, flag in flags.items():
                command.extend((flag, params[name]))
            command.append(str(extra[0]))
        else:
            request_file = self.request_dir / f"{self.counter:05d}.json"
            save_json(request_file, params)
            command.extend(("--cli-input-json", f"file://{request_file}", *map(str, extra)))
        try:
            answer = subprocess.run(command, capture_output=True, text=True, timeout=180,
                                    env={**os.environ, "AWS_PAGER": "", "AWS_CLI_AUTO_PROMPT": "off"})
        except (OSError, subprocess.TimeoutExpired) as error:
            raise AwsError(service, operation, type(error).__name__) from None
        finally:
            if request_file is not None:
                request_file.unlink(missing_ok=True)
        if answer.returncode:
            match = re.search(r"\(([A-Za-z0-9_.-]+)\) when calling", answer.stderr)
            code = match.group(1) if match else "CLI_FAILED"
            raise AwsError(service, operation, code)
        try:
            return json.loads(answer.stdout) if answer.stdout.strip() else {}
        except json.JSONDecodeError:
            raise AwsError(service, operation, "INVALID_JSON") from None


@dataclasses.dataclass
class PublicFile:
    key: str
    path: Path
    content_type: str


def check_context(root: Path, env: dict) -> str:
    if env.get("GITHUB_ACTIONS") != "true" or env.get("GITHUB_REPOSITORY") != REPOSITORY:
        raise DeployError("Execute este instalador pelo workflow do repositório autorizado.")
    if env.get("GITHUB_REF") != "refs/heads/main":
        raise DeployError("Somente a branch main pode publicar em produção.")
    if env.get("GITHUB_EVENT_NAME") not in ("push", "workflow_dispatch"):
        raise DeployError("Evento GitHub não autorizado para publicação.")
    commit = env.get("GITHUB_SHA", "")
    if not re.fullmatch(r"[0-9a-f]{40}", commit) or env.get("JP_CI_PASSED_SHA") != commit:
        raise DeployError("O commit precisa ter concluído o job de testes desta execução.")
    current = subprocess.run(["git", "rev-parse", "HEAD"], cwd=root, capture_output=True,
                             text=True, check=True).stdout.strip()
    if current != commit:
        raise DeployError("O checkout difere do commit aprovado pelos testes.")
    if any(env.get(key) not in (None, "", REGION) for key in ("AWS_REGION", "AWS_DEFAULT_REGION")):
        raise DeployError("Região AWS diferente da região aprovada.")
    for key in ("GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT"):
        if not re.fullmatch(r"[0-9]+", env.get(key, "")):
            raise DeployError("Identificação da execução ausente.")
    version = json.loads((root / "backend/package.json").read_text())
    if version.get("version") != VERSION:
        raise DeployError("Versão do pacote não corresponde à implantação.")
    return commit


def validate_tenant_preflight(snapshot: dict) -> None:
    """Validate the existing account boundary; deployment never mutates Cognito or TTL."""
    pool = snapshot.get("cognito_pool", {}).get("UserPool", {})
    expected_arn = f"arn:aws:cognito-idp:{REGION}:{ACCOUNT}:userpool/{POOL}"
    if pool.get("Id") != POOL or pool.get("Arn") != expected_arn:
        raise DeployError("O pool Cognito não corresponde ao alvo aprovado.")
    if pool.get("AdminCreateUserConfig", {}).get("AllowAdminCreateUserOnly") is not True:
        raise DeployError("O cadastro público de usuários Cognito precisa permanecer desativado.")
    attributes = [attribute for attribute in (pool.get("SchemaAttributes") or [])
                  if isinstance(attribute, dict) and attribute.get("Name") == "custom:empresa_id"]
    if (len(attributes) != 1 or attributes[0].get("AttributeDataType") != "String"
            or attributes[0].get("Mutable") is not False
            or attributes[0].get("Required", False) is not False
            or attributes[0].get("DeveloperOnlyAttribute", False) is not False):
        raise DeployError("O vínculo custom:empresa_id precisa ser String, imutável e não obrigatório no pool Cognito.")
    client = snapshot.get("cognito_client", {}).get("UserPoolClient", {})
    if client.get("ClientId") != CLIENT or client.get("UserPoolId") != POOL or client.get("ClientSecret"):
        raise DeployError("O cliente Cognito precisa corresponder ao cliente público aprovado, sem segredo.")
    read = client.get("ReadAttributes")
    write = client.get("WriteAttributes")
    if (not isinstance(read, list) or any(not isinstance(item, str) for item in read)
            or "custom:empresa_id" not in read):
        raise DeployError("O cliente Cognito precisa permitir a leitura explícita de custom:empresa_id.")
    if (not isinstance(write, list) or not write or any(not isinstance(item, str) for item in write)
            or any(item == "custom:empresa_id" or "*" in item for item in write)):
        # Omitted/default permissions do not prove that a client cannot set a claim.
        raise DeployError("O cliente Cognito precisa ter escrita explícita sem acesso a custom:empresa_id.")
    required_flows = {"ALLOW_USER_PASSWORD_AUTH", "ALLOW_REFRESH_TOKEN_AUTH", "ALLOW_USER_SRP_AUTH"}
    flows = client.get("ExplicitAuthFlows") or []
    if (not isinstance(flows, list) or any(not isinstance(flow, str) for flow in flows)
            or not required_flows.issubset(flows)):
        raise DeployError("Os fluxos de autenticação Cognito existentes precisam ser preservados.")
    groups = {group.get("GroupName") for group in (snapshot.get("cognito_groups", {}).get("Groups") or [])
              if isinstance(group, dict) and group.get("UserPoolId") == POOL}
    if not {"MASTER", "EMPRESA"}.issubset(groups):
        raise DeployError("Os grupos MASTER e EMPRESA precisam existir no pool Cognito aprovado.")
    ttl = snapshot.get("ttl", {}).get("TimeToLiveDescription", {})
    if ttl.get("AttributeName") != "expiresAtEpoch" or ttl.get("TimeToLiveStatus") not in {"ENABLED", "ENABLING"}:
        raise DeployError("A tabela precisa ter TTL expiresAtEpoch habilitado para os controles temporários da importação.")


def validate_preflight(snapshot: dict) -> str:
    identity, function, config = snapshot["identity"], snapshot["function"], snapshot["config"]
    if identity.get("Account") != ACCOUNT or not identity.get("Arn", "").startswith(
            f"arn:aws:sts::{ACCOUNT}:assumed-role/{DEPLOY_ROLE}/"):
        raise DeployError("Conta ou role de implantação diferente da autorizada.")
    table = snapshot["table"]["Table"]
    schema = {item["AttributeName"]: item["KeyType"] for item in table.get("KeySchema", [])}
    types = {item["AttributeName"]: item["AttributeType"] for item in table.get("AttributeDefinitions", [])}
    if table.get("TableStatus") != "ACTIVE" or schema != {"pk": "HASH", "sk": "RANGE"}:
        raise DeployError("Tabela existente não está ativa com as chaves pk/sk esperadas.")
    if types.get("pk") != "S" or types.get("sk") != "S":
        raise DeployError("Tipos de chave da tabela não correspondem ao armazenamento do aplicativo.")
    validate_tenant_preflight(snapshot)
    if config.get("FunctionArn") != FUNCTION_ARN or config.get("Role") != EXECUTION_ROLE:
        raise DeployError("A função existente ou sua role não corresponde ao alvo aprovado.")
    if config.get("PackageType", "Zip") != "Zip" or config.get("Runtime") not in (
            "nodejs20.x", "nodejs22.x", "nodejs24.x"):
        raise DeployError("Runtime ou tipo de pacote da função exige revisão antes da implantação.")
    if config.get("State") != "Active" or config.get("LastUpdateStatus") not in (None, "Successful"):
        raise DeployError("A Lambda não está pronta ou outra atualização está em andamento.")
    if config.get("Environment", {}).get("Error"):
        raise DeployError("Não foi possível ler todas as variáveis atuais da Lambda.")
    if not config.get("RevisionId") or function.get("Configuration", {}).get("RevisionId") != config["RevisionId"]:
        raise DeployError("A revisão da Lambda mudou durante a verificação inicial.")
    if function.get("Configuration", {}).get("CodeSha256") != config.get("CodeSha256"):
        raise DeployError("O hash da Lambda mudou durante a verificação inicial.")
    api = snapshot["api"]
    if api.get("ApiId") != API_ID or api.get("ProtocolType") != "HTTP" or api.get("ApiEndpoint") != API_URL:
        raise DeployError("A API existente não corresponde ao alvo aprovado.")
    matches = [item for item in snapshot["integrations"].get("Items", [])
               if item.get("IntegrationUri") == FUNCTION_ARN and item.get("IntegrationType") == "AWS_PROXY"
               and item.get("PayloadFormatVersion") == "2.0"]
    if len(matches) != 1:
        raise DeployError("Não foi encontrada uma única integração HTTP v2 com a Lambda aprovada.")
    integration = matches[0]["IntegrationId"]
    route_map = {r["RouteKey"]: r for r in snapshot["routes"].get("Items", [])}
    for key in ("ANY /", "ANY /{proxy+}"):
        if route_map.get(key, {}).get("Target") != f"integrations/{integration}":
            raise DeployError("A rota principal mudou; revisão necessária antes de publicar.")
    for key in PUBLIC_ROUTES:
        if key in route_map and route_map[key].get("Target") != f"integrations/{integration}":
            raise DeployError("Uma rota pública já pertence a outra integração.")
    stages = snapshot["stages"].get("Items", [])
    if not any(s.get("StageName") == "$default" and s.get("AutoDeploy") is True for s in stages):
        raise DeployError("A API precisa do stage existente $default com AutoDeploy ativo.")
    return integration


def merged_environment(config: dict, commit: str) -> dict:
    variables = dict(config.get("Environment", {}).get("Variables", {}))
    variables.update(TABLE_NAME=TABLE, DATA_MODE="dynamodb", APP_VERSION=VERSION, BUILD_SHA=commit,
                     COGNITO_ISSUER=ISSUER, COGNITO_CLIENT_ID=CLIENT,
                     COGNITO_USER_POOL_ID=POOL, AUTH_COMPANY_CLAIM="custom:empresa_id")
    return {"Variables": variables}


def content_type(path: Path) -> str:
    return {".js": "application/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
            ".html": "text/html; charset=utf-8", ".json": "application/json; charset=utf-8",
            ".exe": "application/octet-stream",
            ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}.get(
                path.suffix.lower(), mimetypes.guess_type(path.name)[0] or "application/octet-stream")


def prepare_frontend(root: Path, stage: Path, commit: str, run_id: str) -> list[PublicFile]:
    source = root / "frontend/EntregaEPI"
    stage.mkdir(parents=True, exist_ok=True)
    files = []
    for path in sorted((source / "assets").rglob("*")):
        if path.is_symlink():
            raise DeployError("Links simbólicos não são permitidos nos arquivos de publicação.")
        if not path.is_file():
            continue
        relative = path.relative_to(source)
        if any(character in relative.as_posix() for character in ("\n", "\r", "\\")):
            raise DeployError("Nome de arquivo inválido na publicação.")
        target = stage / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(path.read_bytes())
        files.append(PublicFile(f"{PREFIX}/{relative.as_posix()}", target, content_type(path)))
    required = {f"{PREFIX}/assets/{name}" for name in ("app.js", "operations.js", "ficha.js", "biometria.js", "styles.css", EXECUTABLE, MANIFEST, COMPLETE_EXECUTABLE, COMPLETE_MANIFEST)}
    if not required.issubset({item.key for item in files}):
        raise DeployError("Arquivos obrigatórios do frontend estão ausentes.")
    cfg = {"version": VERSION, "buildSha": commit, "appBasePath": f"/{PREFIX}/", "apiBaseUrl": API_URL,
           "cognitoRegion": REGION, "userPoolId": POOL, "clientId": CLIENT, "ambiente": "producao"}
    config_file = stage / "config.js"
    config_file.write_text("window.JP_CONFIG = " + json.dumps(cfg, ensure_ascii=False, indent=2) + ";\n", encoding="utf-8")
    index_file = stage / "index.html"
    index = (source / "index.html").read_text(encoding="utf-8")
    index = index.replace("__APP_PREFIX__", PREFIX).replace("__BUILD_SHA__", commit).replace("__APP_VERSION__", VERSION)
    index_file.write_text(index, encoding="utf-8")
    files.append(PublicFile(f"{PREFIX}/config.js", config_file, content_type(config_file)))
    tail = [PublicFile(f"{PREFIX}/index.html", index_file, content_type(index_file)),
            PublicFile(PREFIX, index_file, content_type(index_file)),
            PublicFile(f"{PREFIX}/", index_file, content_type(index_file))]
    version_file = stage / "version.json"
    manifest = {"version": VERSION, "buildSha": commit, "runId": run_id,
                "preparedAt": now(), "files": {f.key: sha256(f.path) for f in files + tail}}
    source_info = read_source(root / "data/caepi-source.json")
    manifest["caepiSnapshot"] = {field: source_info[field] for field in (
        "sha256", "manifestSha256", "records", "ambiguousRecords", "downloadedAt", "sourceUrl")}
    release = verify_release(stage / "assets", commit)
    manifest["biometria"] = {field: release[field] for field in (
        "version", "buildSha", "filename", "sha256", "sizeBytes")}
    manifest["biometriaCompleta"] = verify_complete(stage / "assets", commit)
    save_json(version_file, manifest, private=False)
    files.append(PublicFile(f"{PREFIX}/version.json", version_file, content_type(version_file)))
    return files + tail


def package_backend(root: Path, destination: Path) -> None:
    backend = root / "backend"
    if not (backend / "node_modules").is_dir() or not (backend / "package-lock.json").is_file():
        raise DeployError("Execute npm ci para preparar o pacote fixado pelo lockfile.")
    selected = [backend / "package.json", backend / "package-lock.json"]
    for folder in ("src", "node_modules"):
        selected.extend(p for p in (backend / folder).rglob("*") if p.is_file() and ".bin" not in p.parts)
    with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for path in sorted(selected):
            if path.is_symlink():
                raise DeployError("O pacote da Lambda contém link simbólico inesperado.")
            info = zipfile.ZipInfo(path.relative_to(backend).as_posix(), (2020, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, path.read_bytes())
    if destination.stat().st_size > 50 * 1024 * 1024:
        raise DeployError("Pacote excede o limite de upload direto escolhido para a Lambda.")
    destination.chmod(0o600)


class Deployment:
    def __init__(self, root: Path, commit: str, env: dict, aws=None):
        self.root, self.commit, self.env = root, commit, env
        self.deploy_dir = root / ".deploy"
        self.private = self.deploy_dir / "private"
        self.private.mkdir(parents=True, exist_ok=True)
        self.private.chmod(0o700)
        self.aws = aws or AwsCli(self.private)
        self.run_id = f"{env['GITHUB_RUN_ID']}-{env['GITHUB_RUN_ATTEMPT']}"
        self.backup_prefix = f"EntregaEPI-backup-actions-{self.run_id}-{commit[:12]}"
        self.snapshot = {}
        self.ca_source = read_source(root / "data/caepi-source.json")
        self.integration = ""
        self.files = []
        self.before = {}
        self.approved_backup_sources = set()
        self.attempted_keys = []
        self.lambda_attempted = False
        self.lambda_owned_hashes = set()
        self.new_zip = self.private / "lambda-new.zip"
        self.old_zip = self.private / "lambda-before.zip"
        self.report = {"version": VERSION, "buildSha": commit, "runId": self.run_id, "startedAt": now(),
                       "status": "running", "checks": [], "files": {}, "rollback": {"attempted": False}}

    def log(self, text: str) -> None:
        print(text, flush=True)

    def check(self, name: str) -> None:
        self.report["checks"].append(name)

    def preflight(self) -> None:
        self.log("Conferindo conta, vínculo Cognito, TTL, função e integração existentes.")
        try:
            release = verify_release(self.root / "frontend/EntregaEPI/assets", self.commit)
        except (ReleaseError, OSError) as error:
            raise DeployError(str(error) if isinstance(error, ReleaseError)
                              else "Não foi possível verificar o componente local de biometria.") from None
        self.report["biometriaRelease"] = {field: release[field] for field in (
            "version", "buildSha", "filename", "sha256", "sizeBytes")}
        self.check("biometria-windows-tested-artifact-version-commit-pe64-and-sha256-verified")
        try:
            self.report["biometriaCompleteRelease"] = verify_complete(self.root / "frontend/EntregaEPI/assets", self.commit)
        except (ValueError, OSError):
            raise DeployError("O instalador completo está ausente ou diverge do hash e commit aprovados.") from None
        self.check("biometria-complete-installer-commit-and-sha256-verified")
        if isinstance(self.aws, AwsCli):
            self.aws.check_support()
        verify_installed(self.root / "backend/src/data/caepi", self.ca_source)
        self.check("caepi-official-snapshot-manifest-and-all-shards-verified")
        self.snapshot = {
            "identity": self.aws.call("sts", "get-caller-identity"),
            "table": self.aws.call("dynamodb", "describe-table", {"TableName": TABLE}),
            "ttl": self.aws.call("dynamodb", "describe-time-to-live", {"TableName": TABLE}),
            "cognito_pool": self.aws.call("cognito-idp", "describe-user-pool", {"UserPoolId": POOL}),
            "cognito_client": self.aws.call("cognito-idp", "describe-user-pool-client", {"UserPoolId": POOL, "ClientId": CLIENT}),
            "cognito_groups": self.aws.call("cognito-idp", "list-groups", {"UserPoolId": POOL}),
            "function": self.aws.call("lambda", "get-function", {"FunctionName": FUNCTION}),
            "config": self.aws.call("lambda", "get-function-configuration", {"FunctionName": FUNCTION}),
        }
        for label, operation in (("api", "get-api"), ("routes", "get-routes"),
                                 ("integrations", "get-integrations"), ("authorizers", "get-authorizers"),
                                 ("stages", "get-stages")):
            self.snapshot[label] = self.aws.call("apigatewayv2", operation, {"ApiId": API_ID})
        self.integration = validate_preflight(self.snapshot)
        save_json(self.private / "aws-before.json", self.snapshot)
        self.check("preflight-account-region-table-keys-lambda-revision-api-integration")
        self.check("preflight-cognito-immutable-company-readonly-client-admin-create-groups")
        self.check("preflight-dynamodb-import-expiration-ttl")

    def download_lambda_backup(self) -> None:
        location = self.snapshot["function"].get("Code", {}).get("Location", "")
        url = urllib.parse.urlparse(location)
        if url.scheme != "https" or not (url.hostname or "").endswith(".amazonaws.com"):
            raise DeployError("URL de download da Lambda não pertence ao domínio AWS esperado.")
        try:
            with urllib.request.urlopen(location, timeout=90) as response, self.old_zip.open("wb") as target:
                while block := response.read(1024 * 1024):
                    target.write(block)
        except (OSError, urllib.error.URLError):
            raise DeployError("Não foi possível baixar a cópia privada da Lambda.") from None
        self.old_zip.chmod(0o600)
        if sha256_b64(self.old_zip) != self.snapshot["config"]["CodeSha256"]:
            raise DeployError("O hash da cópia privada da Lambda não confere.")
        self.lambda_owned_hashes.add(self.snapshot["config"]["CodeSha256"])
        self.check("private-lambda-backup-sha256")

    def get_object(self, key: str, path: Path) -> dict | None:
        path.parent.mkdir(parents=True, exist_ok=True)
        try:
            metadata = self.aws.call("s3api", "get-object", {"Bucket": BUCKET, "Key": key,
                                      "ExpectedBucketOwner": ACCOUNT}, extra=[path])
            path.chmod(0o600)
            return metadata
        except AwsError as error:
            if error.code in ("NoSuchKey", "NotFound", "404"):
                path.unlink(missing_ok=True)
                return None
            raise

    def put_object(self, key: str, path: Path, metadata: dict, condition: dict | None = None) -> dict:
        if not (key in {item.key for item in self.files} or key.startswith(self.backup_prefix + "/")):
            raise DeployError("Tentativa de gravar fora dos arquivos declarados da implantação.")
        if key.startswith(self.backup_prefix + "/") and path not in self.approved_backup_sources:
            raise DeployError("Somente cópias declaradas do frontend podem ser enviadas ao backup público.")
        params = {"Bucket": BUCKET, "Key": key, "ExpectedBucketOwner": ACCOUNT,
                  "ChecksumAlgorithm": "SHA256", "ChecksumSHA256": sha256_b64(path)}
        params.update({key: value for key, value in metadata.items() if key in OBJECT_METADATA_FIELDS})
        params.update(condition or {})
        return self.aws.call("s3api", "put-object", params, extra=["--body", path])

    def backup_frontend(self) -> None:
        self.log("Salvando e verificando somente os arquivos públicos que serão substituídos.")
        manifest = {"version": VERSION, "buildSha": self.commit, "runId": self.run_id, "files": []}
        for index, item in enumerate(self.files):
            local = self.private / "frontend-before" / f"{index:04d}.bin"
            metadata = self.get_object(item.key, local)
            before = {"path": local, "metadata": metadata, "existed": metadata is not None}
            self.before[item.key] = before
            record = {"key": item.key, "existed": before["existed"]}
            if metadata is not None:
                before["sha256"] = sha256(local)
                backup_key = f"{self.backup_prefix}/frontend/{index:04d}.bin"
                self.approved_backup_sources.add(local)
                self.put_object(backup_key, local, metadata, {"IfNoneMatch": "*"})
                verification = self.private / "backup-verification.bin"
                if self.get_object(backup_key, verification) is None or sha256(verification) != before["sha256"]:
                    raise DeployError("Falha ao conferir a cópia de segurança do frontend.")
                verification.unlink(missing_ok=True)
                record.update(backupKey=backup_key, sha256=before["sha256"])
            manifest["files"].append(record)
        manifest_path = self.deploy_dir / "frontend-backup-manifest.json"
        save_json(manifest_path, manifest, private=False)
        self.approved_backup_sources.add(manifest_path)
        self.put_object(f"{self.backup_prefix}/manifest.json", manifest_path,
                        {"ContentType": "application/json; charset=utf-8", "CacheControl": CACHE_CONTROL},
                        {"IfNoneMatch": "*"})
        self.check("frontend-backup-complete-and-verified")

    def protect_api(self) -> None:
        self.log("Aplicando autenticação nas rotas de dados e preservando as consultas públicas previstas.")
        jwt = {"Audience": [CLIENT], "Issuer": ISSUER}
        authorizer = next((item for item in self.snapshot["authorizers"].get("Items", [])
                           if item.get("Name") == "jp-entregaepi-v12-cognito"), None)
        parameters = {"ApiId": API_ID, "Name": "jp-entregaepi-v12-cognito", "AuthorizerType": "JWT",
                      "IdentitySource": ["$request.header.Authorization"], "JwtConfiguration": jwt}
        if authorizer:
            parameters["AuthorizerId"] = authorizer["AuthorizerId"]
            answer = self.aws.call("apigatewayv2", "update-authorizer", parameters)
        else:
            answer = self.aws.call("apigatewayv2", "create-authorizer", parameters)
        authorizer_id = answer["AuthorizerId"]
        route_map = {r["RouteKey"]: r for r in self.snapshot["routes"].get("Items", [])}
        # Explicit public routes have priority over the authenticated greedy route.
        for key in PUBLIC_ROUTES:
            parameters = {"ApiId": API_ID, "RouteKey": key, "Target": f"integrations/{self.integration}",
                          "AuthorizationType": "NONE"}
            if key in route_map:
                parameters.update(RouteId=route_map[key]["RouteId"], AuthorizerId="", AuthorizationScopes=[])
                self.aws.call("apigatewayv2", "update-route", parameters)
            else:
                self.aws.call("apigatewayv2", "create-route", parameters)
        for route in route_map.values():
            if route["RouteKey"] in PUBLIC_ROUTES or route.get("Target") != f"integrations/{self.integration}":
                continue
            self.aws.call("apigatewayv2", "update-route", {"ApiId": API_ID, "RouteId": route["RouteId"],
                          "AuthorizationType": "JWT", "AuthorizerId": authorizer_id,
                          "AuthorizationScopes": []})
        cors = dict(self.snapshot["api"].get("CorsConfiguration", {}))
        headers = list(cors.get("AllowHeaders", []))
        for header in ("content-type", "authorization", "x-empresa-id"):
            if header not in {value.lower() for value in headers}:
                headers.append(header)
        cors["AllowHeaders"] = headers
        self.aws.call("apigatewayv2", "update-api", {"ApiId": API_ID, "CorsConfiguration": cors})
        verified = self.aws.call("apigatewayv2", "get-routes", {"ApiId": API_ID})
        actual_routes = {route["RouteKey"]: route for route in verified.get("Items", [])}
        for key in PUBLIC_ROUTES:
            if actual_routes.get(key, {}).get("AuthorizationType") != "NONE":
                raise DeployError("Uma rota pública prevista não foi configurada corretamente.")
        for route in actual_routes.values():
            if route.get("Target") != f"integrations/{self.integration}" or route["RouteKey"] in PUBLIC_ROUTES:
                continue
            if route.get("AuthorizationType") != "JWT" or route.get("AuthorizerId") != authorizer_id:
                raise DeployError("Uma rota de dados não recebeu a proteção JWT esperada.")
        self.report["apiProtection"] = "JWT retained even if application rollback is required"
        self.check("jwt-routes-cognito-existing-users-unchanged")

    def wait_lambda(self, expected_hash: str | None = None, deadline: int = 420,
                    allow_failed_update: bool = False) -> dict:
        end = time.monotonic() + deadline
        while time.monotonic() < end:
            cfg = self.aws.call("lambda", "get-function-configuration", {"FunctionName": FUNCTION})
            if cfg.get("State") == "Failed" or (cfg.get("LastUpdateStatus") == "Failed" and not allow_failed_update):
                raise DeployError("A Lambda informou falha na atualização.")
            terminal = (None, "Successful", "Failed") if allow_failed_update else (None, "Successful")
            if cfg.get("State") == "Active" and cfg.get("LastUpdateStatus") in terminal:
                if expected_hash is not None and cfg.get("CodeSha256") != expected_hash:
                    raise DeployError("O código da Lambda mudou durante a implantação.")
                return cfg
            time.sleep(5)
        raise DeployError("Tempo limite aguardando a atualização da Lambda.")

    def update_lambda(self) -> None:
        self.log("Atualizando o código e depois o runtime Node.js 22, preservando as variáveis atuais.")
        expected_hash = sha256_b64(self.new_zip)
        self.lambda_owned_hashes.add(expected_hash)
        self.lambda_attempted = True
        self.aws.call("lambda", "update-function-code", {"FunctionName": FUNCTION,
                      "RevisionId": self.snapshot["config"]["RevisionId"]},
                      extra=["--zip-file", f"fileb://{self.new_zip}"])
        cfg = self.wait_lambda(expected_hash)
        if (cfg.get("Environment", {}).get("Variables", {}) != self.snapshot["config"].get("Environment", {}).get("Variables", {})
                or cfg.get("Runtime") != self.snapshot["config"]["Runtime"]):
            raise DeployError("A configuração da Lambda mudou entre a cópia de segurança e a atualização.")
        self.aws.call("lambda", "update-function-configuration", {"FunctionName": FUNCTION,
                      "RevisionId": cfg["RevisionId"], "Runtime": "nodejs22.x",
                      "Environment": merged_environment(self.snapshot["config"], self.commit)})
        cfg = self.wait_lambda(expected_hash)
        if cfg.get("Runtime") != "nodejs22.x" or cfg.get("Environment", {}).get("Variables", {}) != merged_environment(self.snapshot["config"], self.commit)["Variables"]:
            raise DeployError("A configuração publicada da Lambda não corresponde ao commit.")
        self.report["lambdaPackageSha256"] = sha256(self.new_zip)
        self.check("lambda-code-sha256-runtime-node22-environment-preserved")

    @staticmethod
    def http(url: str) -> tuple[int, bytes]:
        request = urllib.request.Request(url, headers={"Accept-Encoding": "identity", "Cache-Control": "no-cache"})
        try:
            with urllib.request.urlopen(request, timeout=25) as answer:
                return answer.status, answer.read()
        except urllib.error.HTTPError as error:
            return error.code, error.read()
        except (OSError, urllib.error.URLError):
            raise DeployError("Falha de conexão na verificação HTTP.") from None

    def smoke_backend(self) -> None:
        for attempt in range(15):
            try:
                status, body = self.http(API_URL + "/health")
                health = json.loads(body)
                ca_status, ca_body = self.http(API_URL + "/api/caepi/365")
                ca = json.loads(ca_body).get("item", {})
                private_status, _ = self.http(API_URL + "/api/empresas")
                correct = (status == 200 and health.get("ok") is True and health.get("version") == VERSION
                           and health.get("buildSha") == self.commit and health.get("mode") == "dynamodb"
                           and health.get("durable") is True and health.get("storageReady") is True
                           and health.get("caepi", {}).get("live") is False
                           and health.get("caepi", {}).get("sourceKind") == "official-snapshot"
                           and health.get("caepi", {}).get("officialTotal") == self.ca_source["records"]
                           and ca_status == 200 and str(ca.get("ca")) == "365" and ca.get("found") is True
                           and ca.get("live") is False and ca.get("verified") is False
                           and ca.get("sourceKind") == "official-snapshot" and ca.get("officialSnapshot") is True
                           and ca.get("downloadedAt") == self.ca_source["downloadedAt"] and private_status == 401)
                if correct:
                    self.check("http-health-version-build-durable-ca-honest-and-anonymous-401")
                    return
            except (DeployError, json.JSONDecodeError, AttributeError):
                pass
            if attempt < 14:
                time.sleep(5)
        raise DeployError("A verificação HTTP da versão, CA e bloqueio sem login não passou.")

    def publish_frontend(self) -> None:
        self.log("Publicando assets, configuração e páginas, nessa ordem.")
        for item in self.files:
            before = self.before[item.key]
            condition = {"IfMatch": before["metadata"]["ETag"]} if before["existed"] else {"IfNoneMatch": "*"}
            self.attempted_keys.append(item.key)
            self.put_object(item.key, item.path, {"ContentType": item.content_type, "CacheControl": CACHE_CONTROL,
                            "Metadata": {"version": VERSION, "build-sha": self.commit, "sha256": sha256(item.path)}}, condition)
            self.report["files"][item.key] = sha256(item.path)
        self.check("frontend-conditional-writes-assets-before-index-no-bulk-delete")

    def invalidate(self, suffix: str) -> None:
        answer = self.aws.call("cloudfront", "create-invalidation", {"DistributionId": DISTRIBUTION,
                               "InvalidationBatch": {"Paths": {"Quantity": 3, "Items": [
                                   f"/{PREFIX}", f"/{PREFIX}/", f"/{PREFIX}/*"]},
                                   "CallerReference": f"entregaepi-{self.run_id}-{suffix}"}})
        invalidation_id = answer["Invalidation"]["Id"]
        end = time.monotonic() + 900
        while time.monotonic() < end:
            state = self.aws.call("cloudfront", "get-invalidation", {"DistributionId": DISTRIBUTION, "Id": invalidation_id})
            if state.get("Invalidation", {}).get("Status") == "Completed":
                return
            time.sleep(5)
        raise DeployError("Tempo limite aguardando a invalidação do CloudFront.")

    def verify_public(self) -> None:
        self.log("Conferindo os bytes públicos e a identificação do commit publicado.")
        for item in self.files:
            url = PUBLIC_URL + "/" + urllib.parse.quote(item.key, safe="/") + "?build=" + self.commit
            status, body = self.http(url)
            if status != 200 or hashlib.sha256(body).hexdigest() != sha256(item.path):
                raise DeployError("Um arquivo público diverge dos bytes aprovados nesta implantação.")
        self.check("cloudfront-invalidation-completed-and-public-sha256-matched")
        self.check("biometria-installer-and-manifest-public-sha256-matched")

    def rollback_frontend(self) -> None:
        expected = {item.key: item for item in self.files}
        errors = []
        for index, key in enumerate(reversed(self.attempted_keys)):
            try:
                before = self.before[key]
                current_path = self.private / "rollback-current" / f"{index:04d}.bin"
                metadata = self.get_object(key, current_path)
                if metadata is None:
                    if not before["existed"]:
                        continue
                    raise DeployError("Arquivo desapareceu durante a implantação; restauração interrompida.")
                digest = sha256(current_path)
                if before["existed"] and digest == before["sha256"]:
                    original_fields = {field: before["metadata"][field] for field in OBJECT_METADATA_FIELDS if field in before["metadata"]}
                    current_fields = {field: metadata[field] for field in OBJECT_METADATA_FIELDS if field in metadata}
                    if original_fields == current_fields:
                        continue
                    if metadata.get("Metadata", {}).get("build-sha") != self.commit:
                        raise DeployError("Metadados foram alterados por outro processo.")
                if digest != sha256(expected[key].path):
                    raise DeployError("Arquivo foi alterado por outro processo; restauração não o sobrescreveu.")
                if before["existed"]:
                    self.put_object(key, before["path"], before["metadata"], {"IfMatch": metadata["ETag"]})
                else:
                    self.aws.call("s3api", "delete-object", {"Bucket": BUCKET, "Key": key,
                                  "ExpectedBucketOwner": ACCOUNT, "IfMatch": metadata["ETag"]})
                restored_meta = self.get_object(key, current_path)
                if before["existed"]:
                    if restored_meta is None or sha256(current_path) != before["sha256"]:
                        raise DeployError("O arquivo restaurado não passou na conferência de hash.")
                elif restored_meta is not None:
                    raise DeployError("Um arquivo novo não foi removido durante a restauração.")
            except DeployError:
                errors.append("Um arquivo do frontend não pôde ser restaurado com segurança.")
        if self.attempted_keys:
            try:
                self.invalidate("rollback")
            except DeployError:
                errors.append("Não foi possível confirmar a invalidação após a restauração.")
        if errors:
            raise DeployError(" ".join(sorted(set(errors))))

    def rollback_lambda(self) -> None:
        if not self.lambda_attempted:
            return
        config = self.wait_lambda(allow_failed_update=True)
        if config.get("CodeSha256") not in self.lambda_owned_hashes:
            raise DeployError("Outra implantação alterou a Lambda; restauração automática não a sobrescreveu.")
        old = self.snapshot["config"]
        old_variables = dict(old.get("Environment", {}).get("Variables", {}))
        current_variables = config.get("Environment", {}).get("Variables", {})
        new_variables = merged_environment(old, self.commit)["Variables"]
        if current_variables not in (old_variables, new_variables) or config.get("Runtime") not in (old["Runtime"], "nodejs22.x"):
            raise DeployError("Outra alteração de configuração foi detectada; restauração não a sobrescreveu.")
        if config.get("CodeSha256") == old["CodeSha256"] and current_variables == old_variables and config.get("Runtime") == old["Runtime"]:
            return
        if config.get("CodeSha256") != old["CodeSha256"]:
            self.aws.call("lambda", "update-function-code", {"FunctionName": FUNCTION,
                          "RevisionId": config["RevisionId"]}, extra=["--zip-file", f"fileb://{self.old_zip}"])
            config = self.wait_lambda(old["CodeSha256"])
        self.aws.call("lambda", "update-function-configuration", {"FunctionName": FUNCTION,
                      "RevisionId": config["RevisionId"], "Runtime": old["Runtime"],
                      "Environment": {"Variables": old_variables}})
        restored = self.wait_lambda(old["CodeSha256"])
        if restored.get("Runtime") != old["Runtime"] or restored.get("Environment", {}).get("Variables", {}) != old.get("Environment", {}).get("Variables", {}):
            raise DeployError("A configuração anterior da Lambda não foi restaurada integralmente.")

    def rollback(self) -> None:
        self.log("A implantação falhou. Restaurando os arquivos e a Lambda anteriores.")
        self.report["rollback"] = {"attempted": True, "status": "running", "apiJwtRetained": True}
        errors = []
        for operation in (self.rollback_frontend, self.rollback_lambda):
            try:
                operation()
            except DeployError as error:
                errors.append(str(error))
            except Exception:
                errors.append("Falha inesperada na restauração; detalhes privados omitidos.")
        self.report["rollback"]["status"] = "failed" if errors else "completed"
        if errors:
            self.report["rollback"]["errors"] = errors

    def run(self) -> None:
        try:
            self.preflight()
            self.files = prepare_frontend(self.root, self.private / "frontend-new", self.commit, self.run_id)
            package_backend(self.root, self.new_zip)
            self.download_lambda_backup()
            self.backup_frontend()
            self.protect_api()
            self.update_lambda()
            self.smoke_backend()
            self.publish_frontend()
            self.invalidate("publish")
            self.verify_public()
            self.smoke_backend()
            self.report["status"] = "success"
            self.log(f"Versão {VERSION} publicada e verificada. Commit {self.commit}.")
        except BaseException as error:
            self.report["status"] = "failed"
            self.report["error"] = str(error) if isinstance(error, DeployError) else "Erro inesperado; detalhes privados omitidos."
            if self.lambda_attempted or self.attempted_keys:
                self.rollback()
            raise DeployError(self.report["error"]) from None
        finally:
            self.report["finishedAt"] = now()
            save_json(self.deploy_dir / "public-report.json", self.report, private=False)
            summary = self.env.get("GITHUB_STEP_SUMMARY")
            if summary:
                with open(summary, "a", encoding="utf-8") as stream:
                    stream.write(f"## JP EntregaEPI {VERSION}\n\nEstado: **{self.report['status']}**\n\n"
                                 f"Commit: `{self.commit}`\n\n"
                                 f"[Aplicativo]({PUBLIC_URL}/{PREFIX}?build={self.commit}) · "
                                 f"[Identificação pública]({PUBLIC_URL}/{PREFIX}/version.json)\n\n")


def interrupted(_signum, _frame):
    raise DeployError("Execução interrompida; iniciando restauração quando aplicável.")


def main() -> int:
    os.umask(0o077)
    root = Path(__file__).resolve().parents[1]
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    try:
        commit = check_context(root, os.environ)
        Deployment(root, commit, dict(os.environ)).run()
        return 0
    except DeployError as error:
        print(f"ERRO: {error}", file=sys.stderr)
        return 1
    except Exception:
        print("ERRO: falha anterior à implantação; detalhes privados omitidos.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
