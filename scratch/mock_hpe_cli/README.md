# Mock HPE Array Storage CLI Utility

This tool allows you to simulate real HPE CLI array commands (such as `showsys`, `showhost`, `showpd`, etc.) inside a **real Windows PowerShell or CMD Command Prompt session**. 

This allows you to test the **Live Host Terminal (PowerShell)** feature of your SAN AI Assistant in manual or auto-execution modes!

---

## 🚀 Quick Setup & Usage

### Step 1: Open your PowerShell session
Open a new **PowerShell** window on your computer.

### Step 2: Load the Mock Commands into your Environment Path
To temporarily add the mock commands to your current shell session, run this command in your PowerShell window:
```powershell
$env:Path += ";c:\Users\isach\OneDrive\Documents\HPEFINALSCHEMA\monorepo\scratch\mock_hpe_cli"
```

*Now, all mock HPE commands are globally registered in that terminal window!*

### Step 3: Verify the command
Run this command in the PowerShell prompt:
```powershell
showsys
```
It will execute `mock_hpe_cli.py` and output the exact configuration telemetry of the active array!

---

## ⚙️ Switch Active Devices
By default, the utility is set to replay telemetry for `prod_a.txt` (PROD-A). You can change the active simulated array target by running:
```powershell
python "c:\Users\isach\OneDrive\Documents\HPEFINALSCHEMA\monorepo\scratch\mock_hpe_cli\mock_hpe_cli.py" set-device prod_b.txt
```
*(Now running `showsys` will output the configuration telemetry for PROD-B!)*

---

## 🤖 Integrating with the SAN AI Agent Gateway
1. Navigate to the **AI Assistant** tab in your browser.
2. In the header bar, click **⚙️ Gateway Setup**.
3. Set **Gateway Connection Protocol** to **Local Host Terminal (Windows PowerShell Core)**.
4. Set **Agent Execution Mode** to **Manual Approval Mode (Human-in-the-loop)**.
5. Click **Apply & Connect**.
6. Type: *"Run diagnostic health check on active array"*
7. The SAN Agent will detect it needs to execute `showsys`. The human-in-the-loop dialog box will appear. Click **Approve** and watch it execute the mock CLI command directly on your real PowerShell terminal!
