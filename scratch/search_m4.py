with open(r"c:\Users\isach\OneDrive\Documents\HPEFINALSCHEMA\monorepo\m4-sshcmdsoutput.txt", "r", encoding="utf-8") as f:
    lines = f.readlines()

for i, line in enumerate(lines):
    if "host-lnx-114" in line:
        print(f"Match at line {i+1}: {line.strip()}")
        # print 10 lines before and after
        start = max(0, i - 15)
        end = min(len(lines), i + 15)
        for idx in range(start, end):
            print(f"  {idx+1}: {lines[idx].strip()}")
