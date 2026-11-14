/* A stand-in game for testing installers. Opens a window and stays open, unless something it needs
 * is missing: data\core.pak next to it (exit 2), or, built with NEEDS_RUNTIME, the "runtime" a
 * bundled installer puts in the Windows folder (exit 3). Built with BROKEN, it always exits 1. */
#include <windows.h>
#include <stdio.h>
#include <string.h>

static LRESULT CALLBACK proc(HWND h, UINT m, WPARAM w, LPARAM l) {
  if (m == WM_DESTROY) { PostQuitMessage(0); return 0; }
  if (m == WM_PAINT) {
    PAINTSTRUCT ps; HDC dc = BeginPaint(h, &ps); RECT r; GetClientRect(h, &r);
    DrawTextA(dc, "Finesse test game: running", -1, &r, DT_CENTER | DT_VCENTER | DT_SINGLELINE);
    EndPaint(h, &ps); return 0;
  }
  return DefWindowProcA(h, m, w, l);
}

static int exists(const char *p) { return GetFileAttributesA(p) != INVALID_FILE_ATTRIBUTES; }

int WINAPI WinMain(HINSTANCE inst, HINSTANCE prev, LPSTR cmd, int show) {
#ifdef BROKEN
  return 1;
#endif
  char dir[MAX_PATH], path[MAX_PATH];
  GetModuleFileNameA(NULL, dir, MAX_PATH);
  char *slash = strrchr(dir, '\\'); if (slash) *slash = 0;
  snprintf(path, sizeof path, "%s\\data\\core.pak", dir);
  if (!exists(path)) return 2;
#ifdef NEEDS_RUNTIME
  GetWindowsDirectoryA(path, MAX_PATH); strcat(path, "\\finesse-runtime.txt");
  if (!exists(path)) return 3;
#endif
  WNDCLASSA wc = {0}; wc.lpfnWndProc = proc; wc.hInstance = inst; wc.lpszClassName = "fg";
  wc.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1); RegisterClassA(&wc);
  CreateWindowA("fg", "Finesse test game", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 100, 100, 640, 360, 0, 0, inst, 0);
  MSG msg; while (GetMessageA(&msg, 0, 0, 0) > 0) { TranslateMessage(&msg); DispatchMessageA(&msg); }
  return 0;
}
