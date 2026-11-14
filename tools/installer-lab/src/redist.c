/* A stand-in for a bundled runtime installer (like Visual C++ or DirectX): writes a marker into the
 * Windows folder that the NEEDS_RUNTIME game checks for. */
#include <windows.h>
#include <string.h>
int WINAPI WinMain(HINSTANCE inst, HINSTANCE prev, LPSTR cmd, int show) {
  char path[MAX_PATH]; GetWindowsDirectoryA(path, MAX_PATH); strcat(path, "\\finesse-runtime.txt");
  HANDLE f = CreateFileA(path, GENERIC_WRITE, 0, 0, CREATE_ALWAYS, 0, 0);
  if (f == INVALID_HANDLE_VALUE) return 5;
  DWORD n; WriteFile(f, "ok", 2, &n, 0); CloseHandle(f); return 0;
}
