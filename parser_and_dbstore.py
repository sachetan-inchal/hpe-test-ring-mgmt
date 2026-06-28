import re
import sys
from pymongo import MongoClient

# ==========================================
# 1. THE UNIVERSAL PARSER
# ==========================================
class CLITableParser:
    def __init__(self):
        # Map known commands to their specific parsing logic
        self.parsers = {
            'showsys': self.parse_showsys,
            'showhost': self.parse_showhost,
            'cli checkhealth': self.parse_health,
            'shownode': self.parse_generic,
            'showswitch': self.parse_generic,
            'showcage': self.parse_generic
        }

    def _extract_table(self, lines, header_keyword):
        """Finds the table block and extracts row data based on header spacing."""
        start_idx = -1
        for i, line in enumerate(lines):
            if header_keyword in line:
                start_idx = i
                break
                
        if start_idx == -1:
            return []

        header_line = lines[start_idx]
        matches = list(re.finditer(r'\S+(?:\s+\S+)*?(?=\s{2,}|\s*$)', header_line))
        
        columns = []
        for i, match in enumerate(matches):
            start = match.start()
            end = matches[i+1].start() if i + 1 < len(matches) else len(header_line)
            col_name = match.group(0).strip('- ')
            columns.append({'name': col_name, 'start': start, 'end': end})

        results = []
        for line in lines[start_idx + 1:]:
            if line.startswith('---') or line.lower().startswith('total') or not line.strip():
                if line.startswith('---'): break
                continue
                
            row_data = {}
            for col in columns:
                value = line[col['start']:col['end']].strip()
                row_data[col['name']] = value
            results.append(row_data)
            
        return results

    def parse_showsys(self, raw_text):
        data = self._extract_table(raw_text, "Model") 
        return data[0] if data else None

    def parse_showhost(self, raw_text):
        raw_hosts = self._extract_table(raw_text, "WWN/iSCSI_Name/NQN")
        normalized_hosts = {}
        current_id = None
        
        for row in raw_hosts:
            if row.get('Id'): 
                current_id = row['Id']
                normalized_hosts[current_id] = {
                    'host_id': current_id,
                    'name': row.get('Name'),
                    'persona': row.get('Persona'),
                    'paths': []
                }
            
            wwn = row.get('WWN/iSCSI_Name/NQN')
            port = row.get('Port')
            if current_id and wwn and wwn != '---':
                normalized_hosts[current_id]['paths'].append({'wwn': wwn, 'port': port})
                
        return list(normalized_hosts.values())

    def parse_health(self, raw_text):
        return self._extract_table(raw_text, "Summary Description")

    def parse_generic(self, raw_text):
        # Uses 'Name' as a common header keyword for nodes, switches, cages
        return self._extract_table(raw_text, "Name")

    def parse(self, command, raw_text):
        # Clean up the command string to match dictionary keys
        cmd_key = command.strip().lower()
        # Handle variations like "showcage -state" vs "showcage"
        cmd_base = cmd_key.split(' ')[0] if 'checkhealth' not in cmd_key else cmd_key
        
        parser_func = self.parsers.get(cmd_key) or self.parsers.get(cmd_base)
        
        if parser_func:
            return parser_func(raw_text)
        return None

# ==========================================
# 2. MONGODB MANAGER
# ==========================================
class MongoManager:
    def __init__(self, uri="mongodb://localhost:27017/", db_name="storage_arrays"):
        self.client = MongoClient(uri)
        self.db = self.client[db_name]
        # For this script, we'll assign a dummy system ID. 
        # In production, you'd extract this from showsys first.
        self.current_system_id = "SYS-UNKNOWN" 

    def insert_data(self, command, parsed_data):
        if not parsed_data:
            return

        cmd_key = command.strip().lower()

        if 'showsys' in cmd_key:
            self.current_system_id = parsed_data.get('Serial', 'SYS-UNKNOWN')
            parsed_data['_id'] = self.current_system_id
            self.db.systems.update_one({'_id': self.current_system_id}, {'$set': parsed_data}, upsert=True)
            print(f"[+] Inserted System: {self.current_system_id}")

        elif 'showhost' in cmd_key:
            for host in parsed_data:
                host['system_id'] = self.current_system_id
                self.db.hosts.update_one(
                    {'system_id': self.current_system_id, 'host_id': host['host_id']}, 
                    {'$set': host}, upsert=True)
            print(f"[+] Inserted {len(parsed_data)} Hosts")

        elif 'checkhealth' in cmd_key:
            self.db.health_checks.delete_many({'system_id': self.current_system_id}) # Clear old alerts
            for alert in parsed_data:
                alert['system_id'] = self.current_system_id
            if parsed_data:
                self.db.health_checks.insert_many(parsed_data)
            print(f"[+] Inserted {len(parsed_data)} Health Alerts")

        elif 'shownode' in cmd_key:
            for node in parsed_data:
                node['system_id'] = self.current_system_id
                self.db.nodes.update_one(
                    {'system_id': self.current_system_id, 'Name': node.get('Name')}, 
                    {'$set': node}, upsert=True)
            print(f"[+] Inserted {len(parsed_data)} Nodes")
            
        # Add similar elif blocks for switches, cages, physical drives...

# ==========================================
# 3. FILE PROCESSOR
# ==========================================
def process_file(filepath):
    # List of known commands to look for in the text file
    known_commands = [
        'showsys', 'showhost', 'shownode', 'showport', 
        'showswitch', 'showpd', 'showcage', 'cli checkhealth', 'showversion'
    ]
    
    with open(filepath, 'r') as f:
        lines = f.readlines()

    blocks = {}
    current_command = None
    
    # Read the file and chunk it by command
    for line in lines:
        clean_line = line.strip()
        
        # Check if the line is one of our known commands (ignoring flags for the match)
        is_command = any(clean_line.startswith(cmd) for cmd in known_commands)
        
        if is_command:
            current_command = clean_line
            blocks[current_command] = []
        elif current_command:
            blocks[current_command].append(line)

    parser = CLITableParser()
    db = MongoManager()

    # Parse and upload each block
    for cmd, output_lines in blocks.items():
        print(f"Processing command: {cmd}...")
        parsed_data = parser.parse(cmd, output_lines)
        
        if parsed_data:
            db.insert_data(cmd, parsed_data)
        else:
            print(f"[-] No data extracted for {cmd}")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python import_array_data.py <path_to_txt_file>")
        sys.exit(1)
        
    target_file = sys.argv[1]
    process_file(target_file)
    print("Database update complete.")