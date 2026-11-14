// winhelper: what the game store's install engine needs to know about, and do to, the windows
// on a screen. A small Windows program, so one tool serves both hosts: natively on Windows and
// under Wine in the Linux sandbox (server/src/gamestore/types.ts: WindowInfo, SandboxRunner).
//
//   winhelper list                 every visible top-level window, as a JSON array
//   winhelper click <hwnd> <label> press the button with that label in that window
//   winhelper shot <file.bmp> [hwnd]  a picture of the screen (or one window); prints
//                                  {"ok":true,"blank":false} (blank = one flat colour)
//
// It only looks and clicks: it never starts, stops or reads another program's memory.
// Output is UTF-8 JSON on stdout; the exit code is 0 unless the command itself failed.

#define WIN32_LEAN_AND_MEAN
#ifndef UNICODE
#define UNICODE
#endif
#ifndef _UNICODE
#define _UNICODE
#endif
#include <windows.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <wchar.h>

// Command links (Vista and later) live in commctrl.h; these are their values.
#ifndef BS_COMMANDLINK
#define BS_COMMANDLINK 0x0000000EL
#define BS_DEFCOMMANDLINK 0x0000000FL
#endif

#define MAX_TEXT 2048
#define MAX_BUTTONS 24

// ---------- JSON out ----------

static void put_json_string(const wchar_t *w) {
  char utf8[MAX_TEXT * 4];
  int n = WideCharToMultiByte(CP_UTF8, 0, w, -1, utf8, (int)sizeof utf8, NULL, NULL);
  if (n <= 0) utf8[0] = 0;
  putchar('"');
  for (const unsigned char *p = (const unsigned char *)utf8; *p; p++) {
    if (*p == '"' || *p == '\\') { putchar('\\'); putchar(*p); }
    else if (*p == '\n') fputs("\\n", stdout);
    else if (*p == '\r') {}
    else if (*p == '\t') fputs("\\t", stdout);
    else if (*p < 0x20) printf("\\u%04x", *p);
    else putchar(*p);
  }
  putchar('"');
}

// ---------- what's in a window ----------

typedef struct {
  wchar_t text[MAX_TEXT];      // labels, joined with newlines
  wchar_t buttons[MAX_BUTTONS][128];
  HWND button_hwnds[MAX_BUTTONS];
  int button_count;
  int wants_input;             // an edit box, a list or a combo that's enabled and visible
} Contents;

static void append_text(Contents *c, const wchar_t *t) {
  size_t have = wcslen(c->text), add = wcslen(t);
  if (!add || have + add + 2 >= MAX_TEXT) return;
  if (have) c->text[have++] = L'\n';
  wcscpy(c->text + have, t);
}

static BOOL CALLBACK each_child(HWND h, LPARAM lp) {
  Contents *c = (Contents *)lp;
  if (!IsWindowVisible(h)) return TRUE;
  wchar_t cls[64] = L"", text[512] = L"";
  GetClassNameW(h, cls, 64);
  // WM_GETTEXT with a timeout: a hung installer must not hang us.
  DWORD_PTR got = 0;
  SendMessageTimeoutW(h, WM_GETTEXT, 512, (LPARAM)text, SMTO_ABORTIFHUNG, 500, &got);
  LONG style = GetWindowLongW(h, GWL_STYLE);
  int enabled = IsWindowEnabled(h);

  if (!_wcsicmp(cls, L"Button") || !_wcsicmp(cls, L"TButton") || !_wcsicmp(cls, L"TNewButton")) {
    int kind = style & BS_TYPEMASK;
    int is_push = !_wcsicmp(cls, L"Button") ? (kind == BS_PUSHBUTTON || kind == BS_DEFPUSHBUTTON || kind == BS_COMMANDLINK || kind == BS_DEFCOMMANDLINK) : 1;
    if (is_push) {
      if (enabled && text[0] && c->button_count < MAX_BUTTONS) {
        wcsncpy(c->buttons[c->button_count], text, 127);
        c->buttons[c->button_count][127] = 0;
        c->button_hwnds[c->button_count++] = h;
      }
    } else if (kind == BS_GROUPBOX) {
      append_text(c, text);
    } else {
      // A check box or a choice between options: something a person decides.
      append_text(c, text);
      if (enabled && (kind == BS_RADIOBUTTON || kind == BS_AUTORADIOBUTTON)) c->wants_input = 1;
    }
  } else if (!_wcsicmp(cls, L"Edit") || !_wcsicmp(cls, L"TEdit") || !_wcsicmp(cls, L"TNewEdit") || !_wcsicmp(cls, L"TPasswordEdit")) {
    // A read-only box (a licence, a log) is text to read, not something to fill in.
    if (enabled && !(style & ES_READONLY)) c->wants_input = 1; else append_text(c, text);
  } else if (!_wcsicmp(cls, L"ComboBox") || !_wcsicmp(cls, L"ListBox") || !_wcsicmp(cls, L"TComboBox") || !_wcsicmp(cls, L"TNewComboBox") || !_wcsicmp(cls, L"TNewCheckListBox") || !_wcsicmp(cls, L"SysTreeView32")) {
    if (enabled) c->wants_input = 1;
  } else if (!_wcsicmp(cls, L"Static") || !wcsncmp(cls, L"TNewStaticText", 14) || !_wcsicmp(cls, L"TLabel") || !_wcsicmp(cls, L"RichEdit20W") || !_wcsicmp(cls, L"RichEdit20A")) {
    append_text(c, text);
  }
  return TRUE;
}

static int first = 1;

static BOOL CALLBACK each_top(HWND h, LPARAM lp) {
  (void)lp;
  // Invisible windows, and untitled windows owned by another (tooltips, drop-down lists), aren't for anyone.
  if (!IsWindowVisible(h) || (GetWindow(h, GW_OWNER) != NULL && !GetWindowTextLengthW(h))) return TRUE;
  RECT r;
  if (!GetWindowRect(h, &r) || r.right - r.left < 8 || r.bottom - r.top < 8) return TRUE;
  wchar_t title[512] = L"", cls[128] = L"";
  DWORD_PTR got = 0;
  SendMessageTimeoutW(h, WM_GETTEXT, 512, (LPARAM)title, SMTO_ABORTIFHUNG, 500, &got);
  GetClassNameW(h, cls, 128);
  // The desktop, the taskbar and Wine's own helper windows aren't anyone's window.
  if (!wcscmp(cls, L"Progman") || !wcscmp(cls, L"Shell_TrayWnd") || !wcscmp(cls, L"WorkerW") || !wcsncmp(cls, L"__wine", 6)) return TRUE;

  Contents *c = calloc(1, sizeof *c);
  if (!c) return FALSE;
  EnumChildWindows(h, each_child, (LPARAM)c);
  DWORD pid = 0;
  GetWindowThreadProcessId(h, &pid);

  printf("%s\n {\"hwnd\":%llu,\"pid\":%lu,\"title\":", first ? "" : ",", (unsigned long long)(UINT_PTR)h, (unsigned long)pid);
  first = 0;
  put_json_string(title);
  fputs(",\"class\":", stdout);
  put_json_string(cls);
  fputs(",\"text\":", stdout);
  put_json_string(c->text);
  fputs(",\"buttons\":[", stdout);
  for (int i = 0; i < c->button_count; i++) {
    if (i) putchar(',');
    put_json_string(c->buttons[i]);
  }
  printf("],\"wantsInput\":%s,\"hung\":%s,\"width\":%ld,\"height\":%ld}", c->wants_input ? "true" : "false", IsHungAppWindow(h) ? "true" : "false", (long)(r.right - r.left), (long)(r.bottom - r.top));
  free(c);
  return TRUE;
}

static int cmd_list(void) {
  fputs("[", stdout);
  EnumWindows(each_top, 0);
  fputs("\n]\n", stdout);
  return 0;
}

// ---------- click ----------

// "&Next >" and "Next" are the same button: compare without the & that marks a shortcut key.
static void plain(const wchar_t *in, wchar_t *out, size_t cap) {
  size_t n = 0;
  for (; *in && n + 1 < cap; in++) if (*in != L'&') out[n++] = *in;
  out[n] = 0;
}

static int cmd_click(const wchar_t *hwnd_arg, const wchar_t *label) {
  HWND h = (HWND)(UINT_PTR)_wcstoui64(hwnd_arg, NULL, 10);
  if (!IsWindow(h)) { puts("{\"ok\":false,\"why\":\"no such window\"}"); return 1; }
  Contents *c = calloc(1, sizeof *c);
  if (!c) return 1;
  EnumChildWindows(h, each_child, (LPARAM)c);
  wchar_t want[128], have[128];
  plain(label, want, 128);
  for (int i = 0; i < c->button_count; i++) {
    plain(c->buttons[i], have, 128);
    if (_wcsicmp(want, have)) continue;
    // BM_CLICK presses it the way a person would, without needing the window in front.
    DWORD_PTR got = 0;
    LRESULT sent = SendMessageTimeoutW(c->button_hwnds[i], BM_CLICK, 0, 0, SMTO_ABORTIFHUNG, 3000, &got);
    free(c);
    puts(sent ? "{\"ok\":true}" : "{\"ok\":false,\"why\":\"the window didn't answer\"}");
    return sent ? 0 : 1;
  }
  free(c);
  puts("{\"ok\":false,\"why\":\"no such button\"}");
  return 1;
}

// ---------- screenshot ----------

static int cmd_shot(const wchar_t *path, const wchar_t *hwnd_arg) {
  HWND h = hwnd_arg ? (HWND)(UINT_PTR)_wcstoui64(hwnd_arg, NULL, 10) : NULL;
  RECT r = { 0, 0, GetSystemMetrics(SM_CXSCREEN), GetSystemMetrics(SM_CYSCREEN) };
  if (h && (!IsWindow(h) || !GetWindowRect(h, &r))) { puts("{\"ok\":false,\"why\":\"no such window\"}"); return 1; }
  int w = r.right - r.left, ht = r.bottom - r.top;
  if (w <= 0 || ht <= 0) { puts("{\"ok\":false,\"why\":\"nothing to picture\"}"); return 1; }

  // Copied from the screen, so it's what a person would see (games draw straight to it).
  HDC screen = GetDC(NULL);
  HDC mem = CreateCompatibleDC(screen);
  BITMAPINFO bi;
  memset(&bi, 0, sizeof bi);
  bi.bmiHeader.biSize = sizeof bi.bmiHeader;
  bi.bmiHeader.biWidth = w;
  bi.bmiHeader.biHeight = -ht; // top-down
  bi.bmiHeader.biPlanes = 1;
  bi.bmiHeader.biBitCount = 32;
  bi.bmiHeader.biCompression = BI_RGB;
  void *bits = NULL;
  HBITMAP bmp = CreateDIBSection(screen, &bi, DIB_RGB_COLORS, &bits, NULL, 0);
  if (!bmp || !bits) { ReleaseDC(NULL, screen); DeleteDC(mem); puts("{\"ok\":false,\"why\":\"out of memory\"}"); return 1; }
  HGDIOBJ old = SelectObject(mem, bmp);
  BOOL copied = BitBlt(mem, 0, 0, w, ht, screen, r.left, r.top, SRCCOPY);
  GdiFlush();

  // Blank = every pixel within a hair of the first one (a black or single-colour screen).
  const unsigned char *px = bits;
  size_t count = (size_t)w * (size_t)ht, differing = 0;
  for (size_t i = 0; i < count; i += 7) {
    const unsigned char *p = px + i * 4;
    if (abs(p[0] - px[0]) > 6 || abs(p[1] - px[1]) > 6 || abs(p[2] - px[2]) > 6) differing++;
  }
  int blank = differing * 7 * 1000 < count; // under 0.1% of the picture differs

  int ok = 0;
  FILE *f = copied ? _wfopen(path, L"wb") : NULL;
  if (f) {
    BITMAPFILEHEADER fh;
    memset(&fh, 0, sizeof fh);
    fh.bfType = 0x4d42;
    fh.bfOffBits = sizeof fh + sizeof bi.bmiHeader;
    fh.bfSize = fh.bfOffBits + (DWORD)(count * 4);
    ok = fwrite(&fh, sizeof fh, 1, f) == 1 && fwrite(&bi.bmiHeader, sizeof bi.bmiHeader, 1, f) == 1 && fwrite(bits, 4, count, f) == count;
    fclose(f);
  }
  SelectObject(mem, old);
  DeleteObject(bmp);
  DeleteDC(mem);
  ReleaseDC(NULL, screen);
  printf("{\"ok\":%s,\"blank\":%s,\"width\":%d,\"height\":%d}\n", ok ? "true" : "false", blank ? "true" : "false", w, ht);
  return ok ? 0 : 1;
}

int wmain(int argc, wchar_t **argv) {
  if (argc >= 2 && !wcscmp(argv[1], L"list")) return cmd_list();
  if (argc >= 4 && !wcscmp(argv[1], L"click")) return cmd_click(argv[2], argv[3]);
  if (argc >= 3 && !wcscmp(argv[1], L"shot")) return cmd_shot(argv[2], argc >= 4 ? argv[3] : NULL);
  fputs("usage: winhelper list | click <hwnd> <label> | shot <file.bmp> [hwnd]\n", stderr);
  return 2;
}
