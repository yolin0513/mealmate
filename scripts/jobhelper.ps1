# Job Object 協助程序（2026-10-08，抄自 StockDiary 2026-10-03 的同名檔、它的 docs/HOWTO_JobObject殺程序樹.md；v11.6 §5.19
# 「殺程序不要靠父程序編號往下找子孫」）。
#
#   powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File scripts/jobhelper.ps1 -TargetPid <要放進 Job 的程序>
#
# 為什麼要這支：Node 沒有建立 Job Object 的 API。這支用 P/Invoke 建一個 Job，設成
#   · JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE（0x2000）：Job 的最後一個 handle 關掉時，裡面的程序全部連帶殺掉
#   · 不設 BREAKAWAY_OK（0x800）／SILENT_BREAKAWAY_OK（0x1000）：裡面的程序開的子孫不准脫離 Job（detached 也逃不掉）
# 把 -TargetPid 放進去之後印一行「JOB-OK <pid>」，然後一直讀標準輸入；標準輸入被關掉（呼叫它的程序結束或被殺）就結束——
# 它持有的 Job handle 跟著關掉，Job 裡的程序全部被殺。放進去之後才開的子孫自動屬於這個 Job，**不看父程序編號**。
# 任何一步失敗就印「JOB-FAIL <原因>」並以 1 結束（呼叫端判成情境未成立，不照跑）。
# 逐一計數（2026-10-08）：標準輸入讀到一行「SUM」就印一行「JOB-SUM started= ended= active= peak= peakmix= left=」（見 MmJob 裡的說明）。
# 驗法：node scripts/jobtest.mjs；突變清單裡「Job：」開頭的幾條。

param([Parameter(Mandatory = $true)][int]$TargetPid)

$ErrorActionPreference = 'Stop'
try {
  Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class MmJob {
  [StructLayout(LayoutKind.Sequential)] public struct BASIC { public long PerProcessUserTimeLimit; public long PerJobUserTimeLimit; public uint LimitFlags; public UIntPtr MinimumWorkingSetSize; public UIntPtr MaximumWorkingSetSize; public uint ActiveProcessLimit; public UIntPtr Affinity; public uint PriorityClass; public uint SchedulingClass; }
  [StructLayout(LayoutKind.Sequential)] public struct IOC { public ulong a; public ulong b; public ulong c; public ulong d; public ulong e; public ulong f; }
  [StructLayout(LayoutKind.Sequential)] public struct EXT { public BASIC Basic; public IOC Io; public UIntPtr ProcessMemoryLimit; public UIntPtr JobMemoryLimit; public UIntPtr PeakProcessMemoryUsed; public UIntPtr PeakJobMemoryUsed; }
  [DllImport("kernel32.dll", SetLastError = true)] public static extern IntPtr CreateJobObject(IntPtr a, string name);
  [DllImport("kernel32.dll", SetLastError = true)] public static extern bool SetInformationJobObject(IntPtr job, int cls, ref EXT info, uint len);
  [DllImport("kernel32.dll", SetLastError = true)] public static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("kernel32.dll", SetLastError = true)] public static extern bool AssignProcessToJobObject(IntPtr job, IntPtr proc);
  [StructLayout(LayoutKind.Sequential)] public struct ASSOC { public IntPtr CompletionKey; public IntPtr CompletionPort; }
  [DllImport("kernel32.dll", SetLastError = true)] public static extern bool SetInformationJobObject(IntPtr job, int cls, ref ASSOC info, uint len);
  [DllImport("kernel32.dll", SetLastError = true)] public static extern IntPtr CreateIoCompletionPort(IntPtr file, IntPtr existing, UIntPtr key, uint threads);
  [DllImport("kernel32.dll", SetLastError = true)] public static extern bool GetQueuedCompletionStatus(IntPtr port, out uint bytes, out UIntPtr key, out IntPtr overlapped, uint ms);

  // 逐一計數（2026-10-08，第 7 項；v11 §5.19「峰值用逐一計數，不用取樣」）：Job 接一個完成埠，每個程序進 Job 收到 NEW_PROCESS（6）、
  // 結束收到 EXIT_PROCESS（7）或 ABNORMAL_EXIT_PROCESS（8）。開、收各自累計（不拿一個去推另一個）；Windows 文件寫明這些通知
  // 「不保證送達」，所以差值可能是負的——照印，不截成 0。算的是 Job 裡**全部**程序（含 jobrun 自己、conhost、Git Bash 的中間程序、
  // 瀏覽器的子程序），跟取樣的「工作程序」定義不同；所以另記峰值那一刻的組成。
  // 結算時逐支核對（2026-10-08 補）：jobtest 在 Job 裡跑時，開 140、收 101——有程序已經不在、卻沒收到結束通知，只加不減，
  // 峰值偏高卻看起來合理（峰值 138，那一刻還列得出早就結束的 csc、cvtres）。所以進 Job 時記下建立時間，結算時查同一個 PID
  // 還在、建立時間也對得上才算「還活著」，其餘算「已經不在、沒收到結束通知」（stale）；有 stale，那一次的峰值不可信（peakok=no）
  public static int Started, Ended, Peak;
  public static string PeakMix = "";
  static System.Collections.Generic.Dictionary<int, string> Active = new System.Collections.Generic.Dictionary<int, string>();
  static System.Collections.Generic.Dictionary<int, long> Born = new System.Collections.Generic.Dictionary<int, long>();
  static object L = new object();
  static IntPtr Port;
  static string Mix() {
    var c = new System.Collections.Generic.SortedDictionary<string, int>();
    foreach (var n in Active.Values) c[n] = (c.ContainsKey(n) ? c[n] : 0) + 1;
    var parts = new System.Collections.Generic.List<string>();
    foreach (var kv in c) parts.Add(kv.Key + "x" + kv.Value);
    return parts.Count == 0 ? "-" : string.Join(",", parts.ToArray());
  }
  static void Loop() {
    while (true) {
      uint msg; UIntPtr key; IntPtr ov;
      if (!GetQueuedCompletionStatus(Port, out msg, out key, out ov, 0xFFFFFFFF)) continue;
      int pid = (int)ov.ToInt64();
      lock (L) {
        if (msg == 6) {
          Started++;
          string n = "unknown"; long born = 0;
          try { var pr = System.Diagnostics.Process.GetProcessById(pid); n = pr.ProcessName; born = pr.StartTime.ToUniversalTime().Ticks; } catch { n = "gone"; }
          Active[pid] = n; Born[pid] = born;
          if (Active.Count > Peak) { Peak = Active.Count; PeakMix = Mix(); }
        } else if (msg == 7 || msg == 8) { Ended++; Active.Remove(pid); Born.Remove(pid); }
      }
    }
  }
  static bool Alive(int pid) {
    long born = Born.ContainsKey(pid) ? Born[pid] : 0;
    if (born == 0) return false;   // 進 Job 那一刻就查不到（已經結束）或讀不到建立時間：沒辦法證明還是同一支，不算活著
    try { var pr = System.Diagnostics.Process.GetProcessById(pid); return !pr.HasExited && pr.StartTime.ToUniversalTime().Ticks == born; } catch { return false; }
  }
  public static string Summary() {
    lock (L) {
      var alive = new System.Collections.Generic.List<int>(); var stale = new System.Collections.Generic.List<int>();
      foreach (var pid in Active.Keys) { if (Alive(pid)) alive.Add(pid); else stale.Add(pid); }
      var ac = new System.Collections.Generic.SortedDictionary<string, int>(); var sc = new System.Collections.Generic.SortedDictionary<string, int>();
      foreach (var p in alive) ac[Active[p]] = (ac.ContainsKey(Active[p]) ? ac[Active[p]] : 0) + 1;
      foreach (var p in stale) sc[Active[p]] = (sc.ContainsKey(Active[p]) ? sc[Active[p]] : 0) + 1;
      var am = new System.Collections.Generic.List<string>(); foreach (var kv in ac) am.Add(kv.Key + "x" + kv.Value);
      var sm = new System.Collections.Generic.List<string>(); foreach (var kv in sc) sm.Add(kv.Key + "x" + kv.Value);
      return "JOB-SUM started=" + Started + " ended=" + Ended + " active=" + Active.Count + " alive=" + alive.Count + " stale=" + stale.Count
        + " peak=" + Peak + " peakok=" + (stale.Count == 0 ? "yes" : "no") + " peakmix=" + PeakMix
        + " left=" + (am.Count == 0 ? "-" : string.Join(",", am.ToArray())) + " stalemix=" + (sm.Count == 0 ? "-" : string.Join(",", sm.ToArray()));
    }
  }

  public static string Make(int pid) {
    IntPtr job = CreateJobObject(IntPtr.Zero, null);
    if (job == IntPtr.Zero) return "CreateJobObject 失敗 " + Marshal.GetLastWin32Error();
    EXT info = new EXT();
    info.Basic.LimitFlags = 0x2000;   // KILL_ON_JOB_CLOSE；不加 0x800（BREAKAWAY_OK）也不加 0x1000（SILENT_BREAKAWAY_OK）
    if (!SetInformationJobObject(job, 9, ref info, (uint)Marshal.SizeOf(typeof(EXT)))) return "SetInformationJobObject 失敗 " + Marshal.GetLastWin32Error();
    // 先接完成埠、再放進程序。**順序不是必要的**：原本這裡寫「不這樣 jobrun 自己會漏數」，2026-10-08 突變實跑把順序反過來，
    // jobrun 照樣被數到——看起來接上完成埠時，系統會替已經在 Job 裡的程序補送 NEW_PROCESS。那是**單次實測、沒有找到文件佐證**，
    // 不要當成事實；只是讀起來直覺才保留這個順序（那條突變是等價突變，已拿掉）
    Port = CreateIoCompletionPort(new IntPtr(-1), IntPtr.Zero, UIntPtr.Zero, 1);
    if (Port == IntPtr.Zero) return "CreateIoCompletionPort 失敗 " + Marshal.GetLastWin32Error();
    ASSOC a = new ASSOC(); a.CompletionKey = job; a.CompletionPort = Port;
    if (!SetInformationJobObject(job, 7, ref a, (uint)Marshal.SizeOf(typeof(ASSOC)))) return "接完成埠失敗 " + Marshal.GetLastWin32Error();
    var t = new System.Threading.Thread(Loop); t.IsBackground = true; t.Start();
    IntPtr p = OpenProcess(0x0100 | 0x0001, false, pid);   // PROCESS_SET_QUOTA | PROCESS_TERMINATE
    if (p == IntPtr.Zero) return "OpenProcess 失敗 " + Marshal.GetLastWin32Error();
    if (!AssignProcessToJobObject(job, p)) return "AssignProcessToJobObject 失敗 " + Marshal.GetLastWin32Error();
    Holder = job;   // 留著 handle：這支程序活著，Job 就在
    return "";
  }
  public static IntPtr Holder;
}
"@
  $why = [MmJob]::Make($TargetPid)
  if ($why) { [Console]::Out.WriteLine("JOB-FAIL $why"); exit 1 }
  [Console]::Out.WriteLine("JOB-OK $TargetPid")
  [Console]::Out.Flush()
  # 等到標準輸入被關掉（呼叫端結束或被殺）；結束時 handle 關掉 → Job 裡的程序全部被殺。
  # 讀到「SUM」就印一行結算（jobrun 在指令結束後要）；先等 300 毫秒，讓剛結束的那幾支的 EXIT 通知送到
  while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }
    if ($line -eq 'SUM') { Start-Sleep -Milliseconds 300; [Console]::Out.WriteLine([MmJob]::Summary()); [Console]::Out.Flush() }
  }
  exit 0
} catch {
  [Console]::Out.WriteLine("JOB-FAIL $($_.Exception.Message)")
  exit 1
}
