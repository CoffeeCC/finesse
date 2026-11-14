// A stand-in for what the helper has to cope with, for its own test (test.sh):
//   testwin box   a message box with OK and Cancel; exits with what was pressed (1 = OK)
//   testwin game  a plain window with a picture in it, for 20 seconds
#ifndef UNICODE
#define UNICODE
#endif
#include <windows.h>
#include <wchar.h>

static LRESULT CALLBACK proc(HWND h, UINT m, WPARAM w, LPARAM l) {
  if (m == WM_PAINT) {
    PAINTSTRUCT ps;
    HDC dc = BeginPaint(h, &ps);
    RECT r;
    GetClientRect(h, &r);
    for (int x = 0; x < r.right; x += 8) {
      RECT bar = { x, 0, x + 8, r.bottom };
      HBRUSH b = CreateSolidBrush(RGB(x % 256, (x * 3) % 256, 160));
      FillRect(dc, &bar, b);
      DeleteObject(b);
    }
    EndPaint(h, &ps);
    return 0;
  }
  if (m == WM_TIMER || m == WM_DESTROY) { PostQuitMessage(0); return 0; }
  return DefWindowProcW(h, m, w, l);
}

int wmain(int argc, wchar_t **argv) {
  if (argc >= 2 && !wcscmp(argv[1], L"box")) return MessageBoxW(NULL, L"Not enough disk space.", L"Setup Error", MB_OKCANCEL | MB_ICONERROR);
  WNDCLASSW wc = { 0 };
  wc.lpfnWndProc = proc;
  wc.hInstance = GetModuleHandleW(NULL);
  wc.lpszClassName = L"StandInGame";
  RegisterClassW(&wc);
  HWND h = CreateWindowW(L"StandInGame", L"Stand-in Game", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 40, 40, 640, 400, NULL, NULL, wc.hInstance, NULL);
  SetTimer(h, 1, 20000, NULL);
  MSG msg;
  while (GetMessageW(&msg, NULL, 0, 0) > 0) { TranslateMessage(&msg); DispatchMessageW(&msg); }
  return 0;
}
