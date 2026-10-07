"""Tenant deployment gates are verified without AWS access or credentials."""
import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import deploy
from test_deploy import COMMIT, ENV, FakeAws, SimulatedDeployment, initial_snapshot, make_project


class TenantPreflightTests(unittest.TestCase):
    def setUp(self):
        self.snapshot, _ = initial_snapshot()

    def test_immutable_claim_public_client_and_ttl_accept_verified_configuration(self):
        for status in ("ENABLED", "ENABLING"):
            with self.subTest(ttl=status):
                snapshot = copy.deepcopy(self.snapshot)
                snapshot["ttl"]["TimeToLiveDescription"]["TimeToLiveStatus"] = status
                deploy.validate_tenant_preflight(snapshot)
        self.assertEqual(deploy.validate_preflight(self.snapshot), "int-1")

    def test_signup_or_mutable_missing_wrong_type_claim_is_rejected(self):
        changes = [
            lambda pool: pool["AdminCreateUserConfig"].update(AllowAdminCreateUserOnly=False),
            lambda pool: pool.pop("AdminCreateUserConfig"),
            lambda pool: pool.update(Id="another-pool"),
            lambda pool: pool.update(Arn="arn:aws:cognito-idp:another-region:000000000000:userpool/another"),
            lambda pool: pool.update(SchemaAttributes=[]),
            lambda pool: pool["SchemaAttributes"][0].update(Name="empresa_id"),
            lambda pool: pool["SchemaAttributes"][0].update(Mutable=True),
            lambda pool: pool["SchemaAttributes"][0].pop("Mutable"),
            lambda pool: pool["SchemaAttributes"][0].update(AttributeDataType="Number"),
            lambda pool: pool["SchemaAttributes"][0].update(Required=True),
            lambda pool: pool["SchemaAttributes"][0].update(DeveloperOnlyAttribute=True),
        ]
        for number, change in enumerate(changes):
            with self.subTest(case=number):
                snapshot = copy.deepcopy(self.snapshot)
                change(snapshot["cognito_pool"]["UserPool"])
                with self.assertRaises(deploy.DeployError):
                    deploy.validate_tenant_preflight(snapshot)

    def test_client_must_be_public_correct_read_claim_and_explicitly_exclude_writes(self):
        changes = [
            lambda client: client.update(ClientId="another-client"),
            lambda client: client.update(UserPoolId="another-pool"),
            lambda client: client.update(ClientSecret="SYNTHETIC-PRIVATE-VALUE"),
            lambda client: client.pop("ReadAttributes"),
            lambda client: client.update(ReadAttributes=["email"]),
            lambda client: client.pop("WriteAttributes"),
            lambda client: client.update(WriteAttributes=[]),
            lambda client: client.update(WriteAttributes=["custom:empresa_id"]),
            lambda client: client.update(WriteAttributes=["email", "custom:*"]),
            lambda client: client.update(WriteAttributes=["*"]),
        ]
        for number, change in enumerate(changes):
            with self.subTest(case=number):
                snapshot = copy.deepcopy(self.snapshot)
                change(snapshot["cognito_client"]["UserPoolClient"])
                with self.assertRaises(deploy.DeployError) as raised:
                    deploy.validate_tenant_preflight(snapshot)
                self.assertNotIn("SYNTHETIC-PRIVATE-VALUE", str(raised.exception))

    def test_existing_auth_flows_must_remain_but_additional_flows_are_preserved(self):
        original = self.snapshot["cognito_client"]["UserPoolClient"]["ExplicitAuthFlows"]
        for flow in original:
            snapshot = copy.deepcopy(self.snapshot)
            snapshot["cognito_client"]["UserPoolClient"]["ExplicitAuthFlows"].remove(flow)
            with self.subTest(missing=flow), self.assertRaises(deploy.DeployError):
                deploy.validate_tenant_preflight(snapshot)
        snapshot = copy.deepcopy(self.snapshot)
        snapshot["cognito_client"]["UserPoolClient"]["ExplicitAuthFlows"].append("ALLOW_USER_AUTH")
        before = copy.deepcopy(snapshot)
        deploy.validate_tenant_preflight(snapshot)
        self.assertEqual(snapshot, before)

    def test_groups_must_belong_to_correct_pool_and_ttl_must_use_exact_attribute(self):
        mutations = [
            lambda state: state["cognito_groups"].update(Groups=[]),
            lambda state: state["cognito_groups"]["Groups"].pop(),
            lambda state: state["cognito_groups"]["Groups"][0].update(UserPoolId="foreign-pool"),
            lambda state: state["ttl"]["TimeToLiveDescription"].update(AttributeName="expiresAt"),
            lambda state: state["ttl"]["TimeToLiveDescription"].update(TimeToLiveStatus="DISABLED"),
            lambda state: state["ttl"]["TimeToLiveDescription"].update(TimeToLiveStatus="DISABLING"),
            lambda state: state.pop("ttl"),
        ]
        for number, mutate in enumerate(mutations):
            with self.subTest(case=number):
                snapshot = copy.deepcopy(self.snapshot)
                mutate(snapshot)
                with self.assertRaises(deploy.DeployError):
                    deploy.validate_tenant_preflight(snapshot)

    def test_invalid_company_boundary_stops_before_any_aws_mutation_or_backup_upload(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            make_project(root)
            aws = FakeAws()
            aws.snapshot["cognito_client"]["UserPoolClient"]["WriteAttributes"].append("custom:empresa_id")
            operation = SimulatedDeployment(root, COMMIT, ENV, aws)
            with self.assertRaisesRegex(deploy.DeployError, "escrita explícita"):
                operation.run()
            self.assertFalse(operation.report["rollback"]["attempted"])
            self.assertFalse(any(call[0] == "s3api" for call in aws.calls))
            self.assertFalse(any(call[1].startswith(("create-", "update-", "put-", "delete-", "admin-")) for call in aws.calls))
            self.assertEqual(aws.snapshot["config"], aws.initial["config"])

    def test_preflight_queries_only_scoped_metadata_and_records_safe_checks(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            make_project(root)
            aws = FakeAws()
            operation = SimulatedDeployment(root, COMMIT, ENV, aws)
            operation.preflight()
            expected = {
                ("cognito-idp", "describe-user-pool"), ("cognito-idp", "describe-user-pool-client"),
                ("cognito-idp", "list-groups"), ("dynamodb", "describe-time-to-live")
            }
            self.assertTrue(expected.issubset({call[:2] for call in aws.calls}))
            for service, command, params in aws.calls:
                if service == "cognito-idp":
                    self.assertEqual(params["UserPoolId"], deploy.POOL)
                    if command == "describe-user-pool-client":
                        self.assertEqual(params["ClientId"], deploy.CLIENT)
                if service == "dynamodb":
                    self.assertEqual(params, {"TableName": deploy.TABLE})
            self.assertIn("preflight-cognito-immutable-company-readonly-client-admin-create-groups", operation.report["checks"])
            self.assertIn("preflight-dynamodb-import-expiration-ttl", operation.report["checks"])

    def test_automation_cannot_modify_cognito_iam_ttl_or_company_records(self):
        with tempfile.TemporaryDirectory() as temp:
            cli = deploy.AwsCli(Path(temp))
            for service, operation in [("cognito-idp", "admin-create-user"), ("cognito-idp", "update-user-pool-client"),
                                       ("cognito-idp", "add-custom-attributes"), ("iam", "put-role-policy"),
                                       ("dynamodb", "update-time-to-live"), ("dynamodb", "scan"), ("dynamodb", "put-item")]:
                with self.subTest(operation=operation), patch.object(deploy.subprocess, "run") as execute:
                    with self.assertRaises(deploy.DeployError):
                        cli.call(service, operation, {})
                    execute.assert_not_called()

    def test_environment_enables_only_verified_company_claim_and_preserves_existing_settings(self):
        config = {"Environment": {"Variables": {"EXISTING_SETTING": "keep", "AUTH_COMPANY_CLAIM": "untrusted-old-value"}}}
        merged = deploy.merged_environment(config, COMMIT)["Variables"]
        self.assertEqual(merged["COGNITO_USER_POOL_ID"], deploy.POOL)
        self.assertEqual(merged["AUTH_COMPANY_CLAIM"], "custom:empresa_id")
        self.assertEqual(merged["COGNITO_ISSUER"], deploy.ISSUER)
        self.assertEqual(merged["COGNITO_CLIENT_ID"], deploy.CLIENT)
        self.assertEqual(merged["EXISTING_SETTING"], "keep")
        self.assertEqual(config["Environment"]["Variables"]["AUTH_COMPANY_CLAIM"], "untrusted-old-value")

    def test_excel_template_is_published_at_existing_asset_path_with_exact_bytes_and_mime(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            make_project(root)
            source = root / "frontend/EntregaEPI/assets/modelo-trabalhadores.xlsx"
            source.write_bytes(b"SYNTHETIC-XLSX-BYTES")
            files = deploy.prepare_frontend(root, root / "stage", COMMIT, "123-1")
            item = next(item for item in files if item.key == "EntregaEPI/assets/modelo-trabalhadores.xlsx")
            self.assertEqual(item.path.read_bytes(), source.read_bytes())
            self.assertEqual(item.content_type, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
            manifest = json.loads((root / "stage/version.json").read_text())
            self.assertEqual(manifest["files"][item.key], deploy.sha256(source))
            self.assertEqual([item.key for item in files][-3:], ["EntregaEPI/index.html", "EntregaEPI", "EntregaEPI/"])


if __name__ == "__main__":
    unittest.main()
