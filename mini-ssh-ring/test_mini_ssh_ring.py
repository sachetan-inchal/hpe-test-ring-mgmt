import os
import json
import unittest
import base64

# Import the flask app and mock DATA_FILE path
from server import app, _encrypt_password, _decrypt_password
import server

TEST_DATA_FILE = os.path.join(os.path.dirname(__file__), "test_ssh_credentials.json")

class TestMiniSshRing(unittest.TestCase):
    def setUp(self):
        # Override server's DATA_FILE with our test file
        self.original_data_file = server.DATA_FILE
        server.DATA_FILE = TEST_DATA_FILE
        
        # Ensure the test file is removed before starting each test
        if os.path.exists(TEST_DATA_FILE):
            os.remove(TEST_DATA_FILE)
            
        # Configure app for testing
        app.config['TESTING'] = True
        self.client = app.test_client()

    def tearDown(self):
        # Restore original DATA_FILE path
        server.DATA_FILE = self.original_data_file
        
        # Clean up test file
        if os.path.exists(TEST_DATA_FILE):
            os.remove(TEST_DATA_FILE)

    def test_password_encryption_decryption(self):
        # Test basic XOR-based encryption/decryption
        password = "my_super_secret_ssh_pass!"
        encrypted = _encrypt_password(password)
        self.assertNotEqual(password, encrypted)
        decrypted = _decrypt_password(encrypted)
        self.assertEqual(password, decrypted)

    def test_credentials_lifecycle(self):
        # 1. Start with an empty list
        response = self.client.get("/api/credentials/list")
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertEqual(data["devices"], [])

        # 2. Save a new credential (valid payload)
        payload = {
            "ip": "192.168.1.100",
            "username": "admin",
            "password": "secret_password",
            "port": 22,
            "device_name": "TestDevice1",
            "category": "Array"
        }
        response = self.client.post("/api/credentials/save", json=payload)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["status"], "saved")

        # 3. Check that it is successfully listed
        response = self.client.get("/api/credentials/list")
        self.assertEqual(response.status_code, 200)
        data = response.get_json()["devices"]
        self.assertEqual(len(data), 1)
        self.assertEqual(data[0]["device_name"], "TestDevice1")
        self.assertEqual(data[0]["ip"], "192.168.1.100")
        self.assertEqual(data[0]["username"], "admin")
        self.assertEqual(data[0]["password"], "secret_password")  # Should be decrypted automatically
        self.assertEqual(data[0]["category"], "Array")

        # 4. Save a second credential
        payload2 = {
            "dns_name": "switch-01.local",
            "username": "root",
            "password": "switch_password",
            "port": 2222,
            "device_name": "Switch1",
            "category": "Switch"
        }
        response = self.client.post("/api/credentials/save", json=payload2)
        self.assertEqual(response.status_code, 200)

        # Verify list contains both
        response = self.client.get("/api/credentials/list")
        devices = response.get_json()["devices"]
        self.assertEqual(len(devices), 2)

        # 5. Save/Update existing (upsert check)
        payload["password"] = "updated_password"
        response = self.client.post("/api/credentials/save", json=payload)
        self.assertEqual(response.status_code, 200)

        # Verify still 2 devices, and the password for TestDevice1 is updated
        response = self.client.get("/api/credentials/list")
        devices = response.get_json()["devices"]
        self.assertEqual(len(devices), 2)
        updated_dev = next(d for d in devices if d["device_name"] == "TestDevice1")
        self.assertEqual(updated_dev["password"], "updated_password")

        # 6. Delete a credential
        delete_payload = {
            "ip": "192.168.1.100"
        }
        response = self.client.post("/api/credentials/delete", json=delete_payload)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["status"], "deleted")

        # Verify only 1 device left
        response = self.client.get("/api/credentials/list")
        devices = response.get_json()["devices"]
        self.assertEqual(len(devices), 1)
        self.assertEqual(devices[0]["device_name"], "Switch1")

        # 7. Try deleting a non-existent device
        response = self.client.post("/api/credentials/delete", json={"ip": "99.99.99.99"})
        self.assertEqual(response.status_code, 404)

    def test_invalid_payloads(self):
        # Missing ip / dns_name
        payload = {
            "username": "admin",
            "password": "pwd"
        }
        response = self.client.post("/api/credentials/save", json=payload)
        self.assertEqual(response.status_code, 400)

        # Missing username
        payload2 = {
            "ip": "1.1.1.1",
            "password": "pwd"
        }
        response = self.client.post("/api/credentials/save", json=payload2)
        self.assertEqual(response.status_code, 400)


if __name__ == "__main__":
    unittest.main()
