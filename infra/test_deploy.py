"""Verificações de implantação inteiramente locais, sem credenciais ou dados reais."""
import base64
import copy
import hashlib
import gzip
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import urllib.parse

import deploy

COMMIT = "a" * 40
ENV = {"GITHUB_RUN_ID": "123", "GITHUB_RUN_ATTEMPT": "1"}


def initial_snapshot():
    code = b"PACOTE-ANTERIOR-SINTETICO"
    config = {"FunctionArn": deploy.FUNCTION_ARN, "Role": deploy.EXECUTION_ROLE,
              "Runtime": "nodejs20.x", "State": "Active", "LastUpdateStatus": "Successful",
              "RevisionId": "revision-0", "CodeSha256": base64.b64encode(hashlib.sha256(code).digest()).decode(),
              "Environment": {"Variables": {"EXISTING_SETTING": "preservar", "TABLE_NAME": deploy.TABLE}}}
    return {"identity": {"Account": deploy.ACCOUNT,
            "Arn": f"arn:aws:sts::{deploy.ACCOUNT}:assumed-role/{deploy.DEPLOY_ROLE}/test"},
            "table": {"Table": {"TableStatus": "ACTIVE", "KeySchema": [
                {"AttributeName": "pk", "KeyType": "HASH"}, {"AttributeName": "sk", "KeyType": "RANGE"}],
                "AttributeDefinitions": [{"AttributeName": "pk", "AttributeType": "S"},
                                         {"AttributeName": "sk", "AttributeType": "S"}]}},
            "ttl": {"TimeToLiveDescription": {"AttributeName": "expiresAtEpoch", "TimeToLiveStatus": "ENABLED"}},
            "cognito_pool": {"UserPool": {"Id": deploy.POOL,
                "Arn": f"arn:aws:cognito-idp:{deploy.REGION}:{deploy.ACCOUNT}:userpool/{deploy.POOL}",
                "AdminCreateUserConfig": {"AllowAdminCreateUserOnly": True},
                "SchemaAttributes": [{"Name": "custom:empresa_id", "AttributeDataType": "String",
                    "Mutable": False, "Required": False, "DeveloperOnlyAttribute": False}]}},
            "cognito_client": {"UserPoolClient": {"UserPoolId": deploy.POOL, "ClientId": deploy.CLIENT,
                "ReadAttributes": ["sub", "email", "custom:empresa_id"], "WriteAttributes": ["email", "name"],
                "ExplicitAuthFlows": ["ALLOW_REFRESH_TOKEN_AUTH", "ALLOW_USER_PASSWORD_AUTH", "ALLOW_USER_SRP_AUTH"]}},
            "cognito_groups": {"Groups": [{"GroupName": name, "UserPoolId": deploy.POOL} for name in ("MASTER", "EMPRESA")]},
            "function": {"Configuration": copy.deepcopy(config), "Code": {"Location": "https://example.s3.sa-east-1.amazonaws.com/test"}},
            "config": config, "api": {"ApiId": deploy.API_ID, "ApiEndpoint": deploy.API_URL,
                "ProtocolType": "HTTP", "CorsConfiguration": {"AllowHeaders": ["content-type", "authorization"],
                    "AllowOrigins": ["*"], "AllowMethods": ["GET", "POST", "OPTIONS"]}},
            "integrations": {"Items": [{"IntegrationId": "int-1", "IntegrationUri": deploy.FUNCTION_ARN,
                "IntegrationType": "AWS_PROXY", "PayloadFormatVersion": "2.0"}]},
            "routes": {"Items": [{"RouteId": "r1", "RouteKey": "ANY /", "AuthorizationType": "NONE", "Target": "integrations/int-1"},
                                   {"RouteId": "r2", "RouteKey": "ANY /{proxy+}", "AuthorizationType": "NONE", "Target": "integrations/int-1"}]},
            "authorizers": {"Items": []}, "stages": {"Items": [{"StageName": "$default", "AutoDeploy": True}]}}, code


class FakeAws:
    def __init__(self):
        self.snapshot, self.code = initial_snapshot()
        self.initial = copy.deepcopy(self.snapshot)
        self.calls = []
        self.objects = {}
        self.revision = 0
        self.corrupt_backup = False
        self.fail_runtime_once = False

    def add_object(self, key, body, metadata=None):
        self.objects[key] = {"body": body, "metadata": {"ContentType": "text/plain",
            "CacheControl": "max-age=0", "Metadata": {}, **(metadata or {})}}

    def object_metadata(self, key):
        obj = self.objects[key]
        return {**copy.deepcopy(obj["metadata"]), "ETag": '"' + hashlib.md5(obj["body"]).hexdigest() + '"'}

    def call(self, service, operation, params=None, extra=()):
        params = params or {}
        self.calls.append((service, operation, copy.deepcopy(params)))
        if service == "sts":
            return copy.deepcopy(self.snapshot["identity"])
        if service == "dynamodb":
            label = {"describe-table": "table", "describe-time-to-live": "ttl"}.get(operation)
            if not label or params != {"TableName": deploy.TABLE}:
                raise AssertionError("Somente metadados da tabela aprovada podem ser consultados.")
            return copy.deepcopy(self.snapshot[label])
        if service == "cognito-idp":
            label = {"describe-user-pool": "cognito_pool", "describe-user-pool-client": "cognito_client", "list-groups": "cognito_groups"}.get(operation)
            expected = {"UserPoolId": deploy.POOL, **({"ClientId": deploy.CLIENT} if operation == "describe-user-pool-client" else {})}
            if not label or params != expected:
                raise AssertionError("Somente metadados do pool e cliente aprovados podem ser consultados.")
            return copy.deepcopy(self.snapshot[label])
        if service == "lambda":
            if operation == "get-function":
                return {"Configuration": copy.deepcopy(self.snapshot["config"]), "Code": self.snapshot["function"]["Code"]}
            if operation == "get-function-configuration":
                return copy.deepcopy(self.snapshot["config"])
            if params["RevisionId"] != self.snapshot["config"]["RevisionId"]:
                raise deploy.AwsError(service, operation, "PreconditionFailedException")
            if operation == "update-function-code":
                self.code = Path(str(extra[1]).removeprefix("fileb://")).read_bytes()
                self.snapshot["config"]["CodeSha256"] = base64.b64encode(hashlib.sha256(self.code).digest()).decode()
            elif operation == "update-function-configuration":
                self.snapshot["config"].update({k: copy.deepcopy(params[k]) for k in ("Runtime", "Environment")})
            else:
                raise AssertionError(operation)
            self.revision += 1
            self.snapshot["config"].update(RevisionId=f"revision-{self.revision}", LastUpdateStatus="Successful")
            if operation == "update-function-configuration" and self.fail_runtime_once:
                self.fail_runtime_once = False
                self.snapshot["config"]["LastUpdateStatus"] = "Failed"
            return copy.deepcopy(self.snapshot["config"])
        if service == "apigatewayv2":
            label = {"get-api": "api", "get-routes": "routes", "get-integrations": "integrations",
                     "get-authorizers": "authorizers", "get-stages": "stages"}.get(operation)
            if label:
                return copy.deepcopy(self.snapshot[label])
            if operation in ("create-authorizer", "update-authorizer"):
                data = {**params, "AuthorizerId": "jwt-1"}
                self.snapshot["authorizers"] = {"Items": [data]}
                return copy.deepcopy(data)
            if operation == "update-route":
                route = next(r for r in self.snapshot["routes"]["Items"] if r["RouteId"] == params["RouteId"])
                route.update(params)
                return copy.deepcopy(route)
            if operation == "create-route":
                route = {**params, "RouteId": "r" + str(len(self.snapshot["routes"]["Items"]) + 1)}
                self.snapshot["routes"]["Items"].append(route)
                return copy.deepcopy(route)
            if operation == "update-api":
                self.snapshot["api"].update(params)
                return copy.deepcopy(self.snapshot["api"])
            raise AssertionError(operation)
        if service == "s3api":
            key = params["Key"]
            if operation == "get-object":
                if key not in self.objects:
                    raise deploy.AwsError(service, operation, "NoSuchKey")
                body = self.objects[key]["body"]
                if self.corrupt_backup and key.startswith("EntregaEPI-backup-actions-"):
                    body = b"COPIA-CORROMPIDA"
                Path(extra[-1]).write_bytes(body)
                return self.object_metadata(key)
            exists = key in self.objects
            if params.get("IfNoneMatch") == "*" and exists:
                raise deploy.AwsError(service, operation, "PreconditionFailed")
            if params.get("IfMatch") and (not exists or params["IfMatch"] != self.object_metadata(key)["ETag"]):
                raise deploy.AwsError(service, operation, "PreconditionFailed")
            if operation == "put-object":
                body = Path(extra[1]).read_bytes()
                expected = base64.b64encode(hashlib.sha256(body).digest()).decode()
                if params.get("ChecksumSHA256") != expected:
                    raise AssertionError("O checksum de envio precisa corresponder aos bytes.")
                self.add_object(key, body, {k: v for k, v in params.items() if k in deploy.OBJECT_METADATA_FIELDS})
                return self.object_metadata(key)
            if operation == "delete-object":
                self.objects.pop(key, None)
                return {}
            raise AssertionError(operation)
        if service == "cloudfront":
            if operation == "create-invalidation":
                assert params["InvalidationBatch"]["Paths"]["Items"] == ["/EntregaEPI", "/EntregaEPI/", "/EntregaEPI/*"]
            return {"Invalidation": {"Id": "invalidation-test", "Status": "Completed"}}
        raise AssertionError((service, operation))


def make_project(root):
    for directory in ("backend/src/data/caepi", "backend/node_modules/synthetic", "frontend/EntregaEPI/assets", "data"):
        (root / directory).mkdir(parents=True)
    (root / "backend/package.json").write_text(json.dumps({"version": deploy.VERSION}))
    (root / "backend/package-lock.json").write_text("{}")
    (root / "backend/src/lambda.js").write_text("export const handler = () => {};")
    (root / "backend/node_modules/synthetic/index.js").write_text("export default {};")
    (root / "frontend/EntregaEPI/index.html").write_text('<script src="/__APP_PREFIX__/assets/app.js"></script>')
    for name in ("app.js", "operations.js", "ficha.js", "biometria.js", "styles.css"):
        (root / "frontend/EntregaEPI/assets" / name).write_text("/* fixture sintética */")
    binary = bytearray(512)
    binary[:2] = b"MZ"
    binary[60:64] = (128).to_bytes(4, "little")
    binary[128:134] = b"PE\0\0\x64\x86"
    binary[152:154] = b"\x0b\x02"
    (root / "frontend/EntregaEPI/assets" / deploy.EXECUTABLE).write_bytes(binary)
    (root / "frontend/EntregaEPI/assets" / deploy.MANIFEST).write_text(json.dumps({
        "version": "12.9.2", "buildSha": COMMIT, "filename": deploy.EXECUTABLE,
        "sha256": hashlib.sha256(binary).hexdigest(), "sizeBytes": len(binary)}))
    ca = root / "backend/src/data/caepi"
    shard_bytes = gzip.compress(json.dumps({"items": [{"ca": "365", "name": "EPI SINTÉTICO"}]}).encode())
    (ca / "ca-000.json.gz").write_bytes(shard_bytes)
    manifest = {"schemaVersion": 1, "sourceKind": "official-snapshot", "total": 1, "ambiguousTotal": 0,
                "downloadedAt": "2026-10-06T00:00:00Z", "shards": [{"bucket": "0", "file": "ca-000.json.gz",
                "sha256": hashlib.sha256(shard_bytes).hexdigest(), "count": 1, "sizeBytes": len(shard_bytes)}]}
    raw = json.dumps(manifest).encode()
    (ca / "manifest.json").write_bytes(raw)
    (root / "data/caepi-source.json").write_text(json.dumps({"url": "https://www.jptreinamentos.com.br/EntregaEPI/caepi-snapshots/fixture.zip",
        "sha256": "b" * 64, "manifestSha256": hashlib.sha256(raw).hexdigest(), "sizeBytes": 123,
        "records": 1, "ambiguousRecords": 0, "downloadedAt": manifest["downloadedAt"], "sourceUrl": "https://example.test"}))


class SimulatedDeployment(deploy.Deployment):
    fail_public = False

    def log(self, text):
        pass

    def download_lambda_backup(self):
        self.old_zip.write_bytes(self.aws.code)
        self.lambda_owned_hashes.add(self.snapshot["config"]["CodeSha256"])
        self.check("private-lambda-backup-sha256")

    def http(self, url):
        if url.startswith(deploy.API_URL):
            variables = self.aws.snapshot["config"].get("Environment", {}).get("Variables", {})
            if url.endswith("/health"):
                return 200, json.dumps({"ok": True, "version": variables.get("APP_VERSION"),
                    "buildSha": variables.get("BUILD_SHA"), "mode": "dynamodb", "durable": True,
                    "storageReady": True, "caepi": {"live": False, "sourceKind": "official-snapshot", "officialTotal": 1}}).encode()
            if url.endswith("/api/caepi/365"):
                return 200, json.dumps({"ok": True, "item": {"ca": "365", "found": True, "live": False,
                    "verified": False, "sourceKind": "official-snapshot", "officialSnapshot": True,
                    "downloadedAt": "2026-10-06T00:00:00Z"}}).encode()
            if url.endswith("/api/empresas"):
                secured = any(r.get("AuthorizationType") == "JWT" for r in self.aws.snapshot["routes"]["Items"])
                return (401 if secured else 200), b"{}"
            raise AssertionError(url)
        if self.fail_public:
            return 200, b"ARQUIVO-DIVERGENTE"
        key = urllib.parse.unquote(urllib.parse.urlparse(url).path).lstrip("/")
        return 200, self.aws.objects[key]["body"]


class DeploymentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        make_project(self.root)
        self.aws = FakeAws()
        for key in ("EntregaEPI", "EntregaEPI/", "EntregaEPI/index.html", "EntregaEPI/config.js",
                    "EntregaEPI/assets/app.js", "EntregaEPI/assets/styles.css"):
            self.aws.add_object(key, ("ANTERIOR:" + key).encode())
        self.aws.add_object("EntregaEPI/biometria/agente-local.exe", b"PRESERVAR-ARQUIVO-NAO-GERENCIADO")
        self.initial_objects = copy.deepcopy(self.aws.objects)
        self.operation = SimulatedDeployment(self.root, COMMIT, ENV, self.aws)

    def test_rejects_other_branch_and_untested_commit_before_any_process(self):
        env = {"GITHUB_ACTIONS": "true", "GITHUB_REPOSITORY": deploy.REPOSITORY,
               "GITHUB_REF": "refs/heads/v12-teste", "GITHUB_EVENT_NAME": "push", "GITHUB_SHA": COMMIT,
               "JP_CI_PASSED_SHA": COMMIT, **ENV}
        with patch.object(deploy.subprocess, "run") as process:
            with self.assertRaisesRegex(deploy.DeployError, "Somente a branch main"):
                deploy.check_context(self.root, env)
            env.update(GITHUB_REF="refs/heads/main", JP_CI_PASSED_SHA="b" * 40)
            with self.assertRaisesRegex(deploy.DeployError, "testes"):
                deploy.check_context(self.root, env)
            process.assert_not_called()

    def test_rejects_wrong_account_table_schema_and_changed_revision(self):
        snapshot, _ = initial_snapshot()
        self.assertEqual(deploy.validate_preflight(snapshot), "int-1")
        bad = copy.deepcopy(snapshot)
        bad["identity"]["Account"] = "000000000000"
        with self.assertRaises(deploy.DeployError):
            deploy.validate_preflight(bad)
        bad = copy.deepcopy(snapshot)
        bad["table"]["Table"]["KeySchema"] = [{"AttributeName": "id", "KeyType": "HASH"}]
        with self.assertRaises(deploy.DeployError):
            deploy.validate_preflight(bad)
        bad = copy.deepcopy(snapshot)
        bad["config"]["RevisionId"] = "concurrent-revision"
        with self.assertRaises(deploy.DeployError):
            deploy.validate_preflight(bad)

    def test_verified_backups_precede_lambda_and_frontend_changes(self):
        self.operation.run()
        self.assertEqual(self.operation.report["status"], "success")
        calls = self.aws.calls
        backup_read_positions = [i for i, c in enumerate(calls) if c[0:2] == ("s3api", "get-object")
                                 and c[2]["Key"].startswith(self.operation.backup_prefix + "/")]
        lambda_position = next(i for i, c in enumerate(calls) if c[0:2] == ("lambda", "update-function-code"))
        self.assertTrue(backup_read_positions)
        self.assertLess(max(backup_read_positions), lambda_position)
        written = [c[2]["Key"] for c in calls if c[0:2] == ("s3api", "put-object")
                   and not c[2]["Key"].startswith(self.operation.backup_prefix)]
        self.assertEqual(written[-3:], ["EntregaEPI/index.html", "EntregaEPI", "EntregaEPI/"])
        self.assertLess(written.index("EntregaEPI/assets/ficha.js"), written.index("EntregaEPI/config.js"))
        self.assertIn("EntregaEPI/version.json", written)
        public = json.loads(self.aws.objects["EntregaEPI/version.json"]["body"])
        self.assertEqual(public["biometria"]["buildSha"], COMMIT)
        installer_key = "EntregaEPI/assets/" + deploy.EXECUTABLE
        self.assertEqual(public["biometria"]["sha256"], hashlib.sha256(self.aws.objects[installer_key]["body"]).hexdigest())
        self.assertEqual(self.operation.report["biometriaRelease"], public["biometria"])
        cfg = self.aws.snapshot["config"]
        self.assertEqual(cfg["Runtime"], "nodejs22.x")
        self.assertEqual(cfg["Environment"]["Variables"]["EXISTING_SETTING"], "preservar")
        self.assertEqual(cfg["Environment"]["Variables"]["BUILD_SHA"], COMMIT)
        self.assertEqual(cfg["Environment"]["Variables"]["AUTH_COMPANY_CLAIM"], "custom:empresa_id")
        self.assertEqual(cfg["Environment"]["Variables"]["COGNITO_USER_POOL_ID"], deploy.POOL)
        self.assertEqual(self.aws.objects["EntregaEPI/biometria/agente-local.exe"], self.initial_objects["EntregaEPI/biometria/agente-local.exe"])
        for key, obj in self.aws.objects.items():
            if key.startswith(self.operation.backup_prefix):
                self.assertNotIn(b"EXISTING_SETTING", obj["body"])
                self.assertNotIn(b"PACOTE-ANTERIOR-SINTETICO", obj["body"])

    def test_corrupt_backup_aborts_before_changing_application(self):
        self.aws.corrupt_backup = True
        with self.assertRaisesRegex(deploy.DeployError, "cópia de segurança"):
            self.operation.run()
        self.assertFalse(any(c[0] == "lambda" and c[1].startswith("update-") for c in self.aws.calls))
        self.assertFalse(any(c[0] == "apigatewayv2" and c[1].startswith(("create-", "update-")) for c in self.aws.calls))
        for key, value in self.initial_objects.items():
            self.assertEqual(self.aws.objects[key], value)

    def test_public_mismatch_restores_previous_files_code_and_configuration(self):
        self.operation.fail_public = True
        with self.assertRaises(deploy.DeployError):
            self.operation.run()
        self.assertEqual(self.operation.report["rollback"]["status"], "completed")
        for key, value in self.initial_objects.items():
            self.assertEqual(self.aws.objects[key], value)
        self.assertNotIn("EntregaEPI/assets/ficha.js", self.aws.objects)
        self.assertNotIn("EntregaEPI/version.json", self.aws.objects)
        cfg = self.aws.snapshot["config"]
        self.assertEqual(cfg["CodeSha256"], self.aws.initial["config"]["CodeSha256"])
        self.assertEqual(cfg["Environment"], self.aws.initial["config"]["Environment"])
        self.assertEqual(cfg["Runtime"], "nodejs20.x")
        self.assertTrue(any(r.get("AuthorizationType") == "JWT" for r in self.aws.snapshot["routes"]["Items"]))
        deleted = {c[2]["Key"] for c in self.aws.calls if c[0:2] == ("s3api", "delete-object")}
        self.assertEqual(deleted, {"EntregaEPI/assets/operations.js", "EntregaEPI/assets/ficha.js", "EntregaEPI/assets/biometria.js",
            "EntregaEPI/assets/" + deploy.EXECUTABLE, "EntregaEPI/assets/" + deploy.MANIFEST,
            "EntregaEPI/version.json"})

    def test_corrupt_installer_aborts_before_aws_calls(self):
        asset = self.root / "frontend/EntregaEPI/assets" / deploy.EXECUTABLE
        asset.write_bytes(asset.read_bytes()[:-1] + b"X")
        with self.assertRaisesRegex(deploy.DeployError, "hash"):
            self.operation.run()
        self.assertEqual(self.aws.calls, [])

    def test_missing_installer_aborts_before_aws_calls(self):
        (self.root / "frontend/EntregaEPI/assets" / deploy.EXECUTABLE).unlink()
        with self.assertRaisesRegex(deploy.DeployError, "ausente"):
            self.operation.run()
        self.assertEqual(self.aws.calls, [])

    def test_failed_lambda_configuration_can_still_be_rolled_back(self):
        self.aws.fail_runtime_once = True
        with self.assertRaises(deploy.DeployError):
            self.operation.run()
        self.assertEqual(self.operation.report["rollback"]["status"], "completed")
        self.assertEqual(self.aws.snapshot["config"]["Runtime"], "nodejs20.x")
        self.assertEqual(self.aws.snapshot["config"]["CodeSha256"], self.aws.initial["config"]["CodeSha256"])

    def test_private_files_cannot_be_uploaded_as_public_backup(self):
        path = self.operation.private / "aws-before.json"
        path.write_text('{"Environment":{"PRIVATE_VALUE":"synthetic"}}')
        for private_path in (path, self.operation.old_zip, self.operation.new_zip):
            with self.assertRaisesRegex(deploy.DeployError, "Somente cópias declaradas"):
                self.operation.put_object(self.operation.backup_prefix + "/unsafe.bin", private_path, {})
        self.assertFalse(self.aws.calls)

    def test_concurrent_lambda_code_is_not_overwritten_by_rollback(self):
        self.operation.preflight()
        self.operation.download_lambda_backup()
        self.operation.lambda_attempted = True
        self.aws.snapshot["config"]["CodeSha256"] = "OUTRO-COMMIT"
        with self.assertRaisesRegex(deploy.DeployError, "Outra implantação"):
            self.operation.rollback_lambda()
        self.assertFalse(any(c[0] == "lambda" and c[1].startswith("update-") for c in self.aws.calls))

    def test_aws_errors_do_not_expose_response_or_request_values(self):
        cli = deploy.AwsCli(self.operation.private)
        response = subprocess.CompletedProcess([], 1, stdout="PRIVATE_RESPONSE", stderr=
            "An error occurred (AccessDeniedException) when calling the UpdateFunctionConfiguration operation: PRIVATE_REQUEST")
        with patch.object(deploy.subprocess, "run", return_value=response) as run:
            with self.assertRaises(deploy.AwsError) as raised:
                cli.call("lambda", "update-function-configuration", {"Environment": {"Variables": {"VALUE": "PRIVATE_VALUE"}}})
        command = run.call_args.args[0]
        self.assertEqual(command[command.index("--cli-error-format") + 1], "legacy")
        self.assertIn("--cli-input-json", command)
        self.assertNotIn("PRIVATE_VALUE", " ".join(command))
        self.assertNotIn("PRIVATE", str(raised.exception))
        self.assertIn("AccessDeniedException", str(raised.exception))
        self.assertFalse(list(cli.request_dir.iterdir()))

    def test_streaming_get_object_uses_explicit_flags_and_outfile_last(self):
        cli = deploy.AwsCli(self.operation.private)
        self.operation.aws = cli
        destination = self.operation.private / "frontend-before" / "streaming.bin"
        expected_body = b"FRONTEND-ANTERIOR-SINTETICO"

        def download(command, **kwargs):
            self.assertEqual(command[:3], ["aws", "s3api", "get-object"])
            self.assertNotIn("--cli-input-json", command)
            self.assertEqual(command[-1], str(destination))
            for flag, value in (("--bucket", deploy.BUCKET),
                                ("--key", "EntregaEPI/assets/app.js"),
                                ("--expected-bucket-owner", deploy.ACCOUNT),
                                ("--cli-error-format", "legacy")):
                self.assertEqual(command[command.index(flag) + 1], value)
            self.assertTrue(kwargs["capture_output"])
            destination.write_bytes(expected_body)
            return subprocess.CompletedProcess(command, 0,
                stdout=json.dumps({"ETag": '"synthetic-etag"', "ContentType": "text/javascript"}), stderr="")

        with patch.object(deploy.subprocess, "run", side_effect=download):
            metadata = self.operation.get_object("EntregaEPI/assets/app.js", destination)
        self.assertEqual(metadata["ETag"], '"synthetic-etag"')
        self.assertEqual(destination.read_bytes(), expected_body)
        self.assertEqual(destination.stat().st_mode & 0o777, 0o600)
        self.assertFalse(list(cli.request_dir.iterdir()))

    def test_streaming_missing_object_is_classified_without_exposing_error_details(self):
        self.operation.aws = deploy.AwsCli(self.operation.private)
        destination = self.operation.private / "missing-object.bin"
        destination.write_bytes(b"ARQUIVO-PARCIAL-SINTETICO")
        response = subprocess.CompletedProcess([], 254, stdout="PRIVATE_RESPONSE", stderr=
            "An error occurred (NoSuchKey) when calling the GetObject operation: PRIVATE_REQUEST")
        with patch.object(deploy.subprocess, "run", return_value=response) as run:
            self.assertIsNone(self.operation.get_object("EntregaEPI/assets/new.js", destination))
        command = run.call_args.args[0]
        self.assertEqual(command[command.index("--cli-error-format") + 1], "legacy")
        self.assertNotIn("--cli-input-json", command)
        self.assertFalse(destination.exists())

    def test_streaming_request_rejects_extra_parameters_before_starting_cli(self):
        cli = deploy.AwsCli(self.operation.private)
        parameters = {"Bucket": deploy.BUCKET, "Key": "EntregaEPI/assets/app.js",
                      "ExpectedBucketOwner": deploy.ACCOUNT, "Unexpected": "PRIVATE_VALUE"}
        with patch.object(deploy.subprocess, "run") as run:
            with self.assertRaisesRegex(deploy.DeployError, "Parâmetros inesperados"):
                cli.call("s3api", "get-object", parameters, extra=[self.operation.private / "output.bin"])
        run.assert_not_called()
        self.assertFalse(list(cli.request_dir.iterdir()))


if __name__ == "__main__":
    unittest.main()
