using System;
using System.Runtime.InteropServices;

namespace Finesse.Setup
{
    static class Native
    {
        // ---------- the window ----------
        [DllImport("user32.dll")] static extern bool ReleaseCapture();
        [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindow(string cls, string title);
        [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hWnd);
        [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hWnd, int cmd);
        [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);

        /// <summary>Lets the page's title bar move the window, like a real one.</summary>
        public static void DragWindow(IntPtr hwnd)
        {
            ReleaseCapture();
            SendMessage(hwnd, 0xA1 /* WM_NCLBUTTONDOWN */, (IntPtr)2 /* HTCAPTION */, IntPtr.Zero);
        }

        /// <summary>Windows 11: rounded corners and a dark frame. Older Windows ignores both.</summary>
        public static void Style(IntPtr hwnd)
        {
            int round = 2; // DWMWCP_ROUND
            DwmSetWindowAttribute(hwnd, 33 /* DWMWA_WINDOW_CORNER_PREFERENCE */, ref round, 4);
            int dark = 1;
            DwmSetWindowAttribute(hwnd, 20 /* DWMWA_USE_IMMERSIVE_DARK_MODE */, ref dark, 4);
            int border = 0x0E0908; // COLORREF (BGR) of ink-950
            DwmSetWindowAttribute(hwnd, 34 /* DWMWA_BORDER_COLOR */, ref border, 4);
        }

        public static void FocusExisting(string title)
        {
            var h = FindWindow(null, title);
            if (h == IntPtr.Zero) return;
            ShowWindow(h, 9 /* SW_RESTORE */);
            SetForegroundWindow(h);
        }

        // ---------- memory ----------
        [StructLayout(LayoutKind.Sequential)]
        class MemoryStatus
        {
            public uint Length = (uint)Marshal.SizeOf(typeof(MemoryStatus));
            public uint Load;
            public ulong TotalPhys, AvailPhys, TotalPageFile, AvailPageFile, TotalVirtual, AvailVirtual, AvailExtendedVirtual;
        }
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool GlobalMemoryStatusEx([In, Out] MemoryStatus m);

        public static ulong TotalMemory()
        {
            var m = new MemoryStatus();
            return GlobalMemoryStatusEx(m) ? m.TotalPhys : 0;
        }

        // ---------- the folder picker (the modern one, not the old tree) ----------
        [ComImport, Guid("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7")] class FileOpenDialogCls { }

        [ComImport, Guid("42f85136-db7e-439c-85f1-e4075d135fc8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IFileDialog
        {
            [PreserveSig] int Show(IntPtr parent);
            void SetFileTypes(uint count, IntPtr specs);
            void SetFileTypeIndex(uint index);
            void GetFileTypeIndex(out uint index);
            void Advise(IntPtr events, out uint cookie);
            void Unadvise(uint cookie);
            void SetOptions(uint fos);
            void GetOptions(out uint fos);
            void SetDefaultFolder(IShellItem item);
            void SetFolder(IShellItem item);
            void GetFolder(out IShellItem item);
            void GetCurrentSelection(out IShellItem item);
            void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string name);
            void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string name);
            void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string title);
            void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string text);
            void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string label);
            void GetResult(out IShellItem item);
            void AddPlace(IShellItem item, int where);
            void SetDefaultExtension([MarshalAs(UnmanagedType.LPWStr)] string ext);
            void Close(int hr);
            void SetClientGuid(ref Guid guid);
            void ClearClientData();
            void SetFilter(IntPtr filter);
        }

        [ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IShellItem
        {
            void BindToHandler(IntPtr pbc, ref Guid bhid, ref Guid riid, out IntPtr ppv);
            void GetParent(out IShellItem item);
            void GetDisplayName(uint sigdn, [MarshalAs(UnmanagedType.LPWStr)] out string name);
            void GetAttributes(uint mask, out uint attribs);
            void Compare(IShellItem other, uint hint, out int order);
        }

        [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
        static extern void SHCreateItemFromParsingName(string path, IntPtr pbc, ref Guid riid, out IShellItem item);

        /// <summary>Returns the chosen folder, or null if cancelled.</summary>
        public static string PickFolder(IntPtr owner, string title, string start)
        {
            var dialog = (IFileDialog)new FileOpenDialogCls();
            try
            {
                dialog.SetOptions(0x20 /* PICKFOLDERS */ | 0x40 /* FORCEFILESYSTEM */ | 0x800 /* PATHMUSTEXIST */);
                dialog.SetTitle(title);
                dialog.SetOkButtonLabel("Use this folder");
                if (!string.IsNullOrEmpty(start))
                {
                    try
                    {
                        string existing = start;
                        while (!string.IsNullOrEmpty(existing) && !System.IO.Directory.Exists(existing)) existing = System.IO.Path.GetDirectoryName(existing);
                        if (!string.IsNullOrEmpty(existing))
                        {
                            var iid = typeof(IShellItem).GUID;
                            SHCreateItemFromParsingName(existing, IntPtr.Zero, ref iid, out var folder);
                            dialog.SetFolder(folder);
                        }
                    }
                    catch { /* start somewhere else */ }
                }
                if (dialog.Show(owner) != 0) return null;
                dialog.GetResult(out var item);
                item.GetDisplayName(0x80058000 /* SIGDN_FILESYSPATH */, out var path);
                return path;
            }
            finally { Marshal.ReleaseComObject(dialog); }
        }
    }
}
