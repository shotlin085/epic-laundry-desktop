import { type FormEvent, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Building2,
  CheckCircle2,
  Circle,
  HardDrive,
  KeyRound,
  MapPinned,
  Pencil,
  Plus,
  Printer,
  Save,
  ShieldCheck,
  UserRound,
  UsersRound,
  Warehouse,
} from "lucide-react";
import { Link } from "react-router-dom";
import QRCode from "qrcode";
import { apiGet, apiPatch, apiPost } from "@/lib/api";

type TagTemplate = {
  preset:
    | "a4-4"
    | "a4-6"
    | "a4-8"
    | "a4-10"
    | "thermal-50.8x51.4"
    | "thermal-50x25"
    | "custom";
  widthMm: number;
  heightMm: number;
  columns: number;
  rows: number;
  orientation: "portrait" | "landscape";
  pageSize: "A4" | "thermal";
  marginMm: number;
  fontScale: number;
  lineSpacing: number;
  codeFormat: "qr" | "code128" | "qr+code128";
  showLogo: boolean;
  showGarment: boolean;
  showService: boolean;
  showInvoiceNumber: boolean;
  showPhone: boolean;
  showOrderDate: boolean;
  showTagCode: boolean;
  showStoreName: boolean;
  showCustomer: boolean;
  showOrder: boolean;
  showDueDate: boolean;
  showSequence: boolean;
  showNotes: boolean;
  showExpress: boolean;
  showSpecialCare: boolean;
};
type Settings = {
  businessName: string;
  address: string;
  phone: string;
  email: string;
  upiId: string;
  qrOnPrint: boolean;
  logoDataUrl: string;
  taxMode: "none" | "gst";
  gstin: string;
  currency: string;
  timezone: string;
  printerProfile: string;
  afterBooking: "ask" | "open-print-centre" | "auto-print" | "none";
  printerProfiles: PrinterProfile[];
  tagTemplate: TagTemplate;
  stationCapacities: Record<string, number>;
  setupProgress?: {
    business: boolean;
    owner: boolean;
    operations: boolean;
    catalogue: boolean;
    recovery: boolean;
    updatedAt: string;
    updatedBy: string;
  };
};
type PrinterProfile = {
  id: string;
  name: string;
  kind: "receipt" | "tag";
  connection: "system-dialog" | "usb" | "network" | "file";
  device: string;
  paperWidthMm: number;
  paperHeightMm: number;
  orientation: "portrait" | "landscape";
  marginMm: number;
  dpi: number;
  copies: number;
  silentPrintEnabled: boolean;
  active: boolean;
  supportsQr: boolean;
  supportsBarcode: boolean;
};
type Role = "owner" | "counter_staff" | "processing_staff" | "rider";
type Staff = {
  id: string;
  username: string;
  roles: Role[];
  enabled: boolean;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  description: string;
  riderId?: string;
  createdAt: string;
};
type StaffDraft = {
  username: string;
  password: string;
  roles: Role[];
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  description: string;
  riderId: string;
};
type Rider = { id: string; name: string; phone: string };
type ServiceZone = {
  id: string;
  name: string;
  code: string;
  active: boolean;
  pickupWindow: string;
  deliveryWindow: string;
  notes: string;
};
type RackProfile = {
  id: string;
  name: string;
  code: string;
  capacity: number;
  active: boolean;
  notes: string;
};
type RecoveryRehearsalReport = {
  ok: boolean;
  verifiedAt: string;
  snapshot: string;
  encrypted: boolean;
  rows: number;
  financialEntries: number;
  financialDocuments: number;
  customerLedgerEntries: number;
  cashShiftCloses: number;
  freshDatabase?: {
    ok: boolean;
    isolatedDatabase: boolean;
    digest: string;
    counts: Record<string, number>;
  };
};
type Branch = {
  id: string;
  name: string;
  code: string;
  enabled: boolean;
  roles: Role[];
};
type Diagnostics = {
  format: string;
  version: number;
  generatedAt: string;
  application: { name: string; version: string; server: string };
  runtime: { node: string; platform: string; arch: string };
  workspace: { tenant: string; storeId: string; mode: string };
  health: { status: string };
  migrations: Array<{
    version: number;
    name: string;
    checksum: string;
    appliedAt: string;
  }>;
  counts: {
    entityCounts: Record<string, number>;
    recordCounts: Record<string, number>;
    garmentUnits: number;
    garmentUnitEvents: number;
    tagReprints: number;
    financialEntries: number;
    identities: number;
    activeSessions: number;
    storeSettingsConfigured: boolean;
  };
  hardware: Array<{ kind: string; adapter: string; status: string }>;
  redaction: Record<string, string>;
};
type HardwareStatus = {
  kind: string;
  adapter: string;
  status: string;
  evidence: string;
  health: "not_configured" | "awaiting_evidence" | "evidence_seen" | "degraded";
  receiptCount: number;
  failedReceipts: number;
  lastReceiptAt: string | null;
  lastReceiptStatus: string | null;
  lastDevice: string | null;
};
type NormalizationRun = {
  id: string;
  actor: string;
  status: string;
  reconciliationStatus: string;
  reconciliationIssueCount: number;
  createdAt: string;
  documentsApplied: number;
  entriesApplied: number;
  ledgerEntriesApplied: number;
  walletEntriesApplied: number;
  cashCloseSnapshotsApplied: number;
  sourceColumnsApplied: number;
};
type NormalizationPreview = {
  candidates: number;
  ledgerCandidates: number;
  walletCandidates: number;
  cashCloseCandidates: number;
  missingDocuments: number;
  missingEntries: number;
  missingLedgerEntries: number;
  missingWalletEntries: number;
  missingCashCloseSnapshots: number;
  missingSourceColumns: number;
  invalid: number;
  conflicts: number;
  issues: Array<{ sourceEntity: string; sourceId: string; message: string }>;
  conflictDetails: Array<{
    sourceEntity: string;
    sourceId: string;
    message: string;
  }>;
  latestCertifiedRun?: NormalizationRun;
};
type CompatibilityAudit = {
  generatedAt: string;
  summary: {
    entitiesReviewed: number;
    entitiesPresent: number;
    compatibilityRows: number;
    dualReadRows: number;
    unresolvedRows: number;
    retirementReady: boolean;
  };
  items: Array<{
    entity: string;
    target: string;
    compatibilityRows: number;
    normalizedRows: number;
    status: string;
    retirementBlocker: string | null;
  }>;
  policy: string;
};
type EntityNormalizationPreview = {
  format: string;
  version: number;
  entity: "party" | "laundry_order";
  sourceCount: number;
  normalizedCount: number;
  valid: number;
  invalid: number;
  issues: Array<{ sourceId: string; message: string }>;
  sourceHash: string;
  latestRun?: {
    id: string;
    status: string;
    cursor: number;
    total: number;
    applied: number;
    invalid: number;
    conflicts: number;
    sourceHash: string;
    updatedAt: string;
    completedAt?: string;
  };
  readyToApply: boolean;
};
type GarmentBackfillPreview = {
  candidateCount: number;
  skippedNonPhysical: number;
  issueCount: number;
  capped: boolean;
  candidates: Array<{
    orderNumber: string;
    itemIndex: number;
    sequence: number;
    unit: string;
  }>;
  issues: Array<{ orderId: string; itemIndex?: number; message: string }>;
};

const stationLabels = [
  "Intake",
  "Sorting",
  "Processing",
  "Quality control",
  "Rewash",
  "Assembly",
  "Rack",
  "Dispatch",
];
const defaultStationCapacities: Record<string, number> = {
  Intake: 20,
  Sorting: 20,
  Processing: 20,
  "Quality control": 12,
  Rewash: 8,
  Assembly: 16,
  Rack: 20,
  Dispatch: 12,
};
const defaultTagTemplate: TagTemplate = {
  preset: "a4-6",
  widthMm: 96,
  heightMm: 84,
  columns: 2,
  rows: 3,
  orientation: "portrait",
  pageSize: "A4",
  marginMm: 8,
  fontScale: 1,
  lineSpacing: 1,
  codeFormat: "qr",
  showLogo: true,
  showGarment: true,
  showService: true,
  showInvoiceNumber: false,
  showPhone: false,
  showOrderDate: false,
  showTagCode: true,
  showStoreName: true,
  showCustomer: true,
  showOrder: true,
  showDueDate: true,
  showSequence: true,
  showNotes: false,
  showExpress: true,
  showSpecialCare: true,
};
const blank: Settings = {
  businessName: "",
  address: "",
  phone: "",
  email: "",
  upiId: "",
  qrOnPrint: false,
  logoDataUrl: "",
  taxMode: "none",
  gstin: "",
  currency: "INR",
  timezone: "Asia/Kolkata",
  printerProfile: "",
  afterBooking: "ask",
  printerProfiles: [],
  tagTemplate: defaultTagTemplate,
  stationCapacities: defaultStationCapacities,
};
const blankStaff: StaffDraft = {
  username: "",
  password: "",
  roles: ["counter_staff"],
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  description: "",
  riderId: "",
};
const roleLabels: Record<Role, string> = {
  owner: "Owner",
  counter_staff: "Counter",
  processing_staff: "Processing",
  rider: "Captain",
};

const settingsAreas = [
  {
    id: "workspace-setup",
    label: "Workspace",
    detail: "Business, access and branches",
    icon: Building2,
  },
  {
    id: "operations-setup",
    label: "Operations",
    detail: "Capacity, zones and racks",
    icon: Warehouse,
  },
  {
    id: "finance-controls",
    label: "Finance controls",
    detail: "Normalization and compatibility",
    icon: ShieldCheck,
  },
  {
    id: "printing-setup",
    label: "Printing",
    detail: "Tags, printers and output",
    icon: Printer,
  },
  {
    id: "data-safety",
    label: "Data safety",
    detail: "Backups, recovery and diagnostics",
    icon: HardDrive,
  },
] as const;

export default function LaundrySettings() {
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryKey: ["store-settings"],
    queryFn: () => apiGet<Settings>("/settings/store"),
  });
  const staff = useQuery({
    queryKey: ["store-staff"],
    queryFn: () => apiGet<Staff[]>("/settings/staff"),
  });
  const riders = useQuery({
    queryKey: ["laundry-riders"],
    queryFn: () => apiGet<Rider[]>("/laundry/riders"),
  });
  const branches = useQuery({
    queryKey: ["branch-memberships"],
    queryFn: () => apiGet<Branch[]>("/settings/stores"),
  });
  const diagnostics = useQuery({
    queryKey: ["support-diagnostics"],
    queryFn: () => apiGet<Diagnostics>("/ops/diagnostics"),
  });
  const catalogue = useQuery({
    queryKey: ["laundry-catalogue"],
    queryFn: () =>
      apiGet<{ garments: unknown[]; services: unknown[]; taxRules: unknown[] }>(
        "/laundry/catalogue",
      ),
  });
  const normalization = useQuery({
    queryKey: ["financial-normalization"],
    queryFn: () => apiGet<NormalizationPreview>("/ops/financial-normalization"),
  });
  const compatibility = useQuery({
    queryKey: ["compatibility-retirement-audit"],
    queryFn: () => apiGet<CompatibilityAudit>("/ops/compatibility-audit"),
  });
  const [form, setForm] = useState<Settings>(blank);
  const [notice, setNotice] = useState("");
  const [qrPreview, setQrPreview] = useState("");
  const [draft, setDraft] = useState<StaffDraft>(blankStaff);
  const [editing, setEditing] = useState<Staff | null>(null);
  const [linkedIdentity, setLinkedIdentity] = useState("");
  const [linkedRider, setLinkedRider] = useState("");
  const [branchName, setBranchName] = useState("");
  const [branchCode, setBranchCode] = useState("");
  const [backupLocation, setBackupLocation] = useState<{
    configured: boolean;
    path: string;
  } | null>(null);
  const [backupHealth, setBackupHealth] = useState<{
    healthy: boolean;
    writable: boolean;
    stale: boolean;
    ageHours: number | null;
    reason: string;
    encrypted: boolean;
    latest: string | null;
    rehearsal?: RecoveryRehearsalReport | null;
  } | null>(null);
  type SettingsAreaId = (typeof settingsAreas)[number]["id"];
  const [activeArea, setActiveArea] = useState<SettingsAreaId>("workspace-setup");

  useEffect(() => {
    if (settings.data)
      setForm({
        ...blank,
        ...settings.data,
        taxMode: settings.data.taxMode || "none",
        gstin: settings.data.gstin || "",
        currency: settings.data.currency || "INR",
        timezone: settings.data.timezone || "Asia/Kolkata",
        printerProfile: settings.data.printerProfile || "",
        afterBooking: settings.data.afterBooking || "ask",
        printerProfiles: settings.data.printerProfiles || [],
        tagTemplate: {
          ...defaultTagTemplate,
          ...(settings.data.tagTemplate || {}),
        },
        stationCapacities: {
          ...defaultStationCapacities,
          ...(settings.data.stationCapacities || {}),
        },
      });
  }, [settings.data]);
  useEffect(() => {
    window.epic
      ?.backupLocation?.()
      .then(setBackupLocation)
      .catch(() => setBackupLocation(null));
    window.epic
      ?.backupStatus?.()
      .then(setBackupHealth)
      .catch(() => setBackupHealth(null));
  }, []);
  useEffect(() => {
    const upiId = form.upiId.trim();
    if (!upiId) {
      setQrPreview("");
      return;
    }
    const payload = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(form.businessName || "Epic Laundry")}&cu=INR`;
    QRCode.toDataURL(payload, {
      width: 220,
      margin: 1,
      color: { dark: "#123039", light: "#ffffff" },
    })
      .then(setQrPreview)
      .catch(() => setQrPreview(""));
  }, [form.businessName, form.upiId]);

  const saveProgress = useMutation({
    mutationFn: (input: Partial<NonNullable<Settings["setupProgress"]>>) =>
      apiPost<NonNullable<Settings["setupProgress"]>>(
        "/settings/setup-progress",
        input,
      ),
    onSuccess: (progress) => {
      queryClient.setQueryData<Settings>(["store-settings"], (current) =>
        current ? { ...current, setupProgress: progress } : current,
      );
      setNotice("Setup checklist updated and audited.");
    },
    onError: (error: Error) =>
      setNotice(error.message || "Could not update setup progress."),
  });
  const save = useMutation({
    mutationFn: () => apiPost<Settings>("/settings/store", form),
    onSuccess: (data) => {
      queryClient.setQueryData(["store-settings"], data);
      setNotice("Store profile saved locally.");
    },
    onError: (error: Error) =>
      setNotice(error.message || "Could not save the store profile."),
  });
  const setStaffEnabled = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      apiPost(`/settings/staff/${id}/enabled`, { enabled }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["store-staff"] });
      setNotice("Staff access updated.");
    },
    onError: (error: Error) =>
      setNotice(error.message || "Could not update staff access."),
  });
  const createStaff = useMutation({
    mutationFn: (input: StaffDraft) => apiPost<Staff>("/settings/staff", input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["store-staff"] });
      setDraft(blankStaff);
      setNotice(
        "Staff account created. Share the temporary password securely.",
      );
    },
    onError: (error: Error) =>
      setNotice(error.message || "Could not create staff account."),
  });
  const updateStaff = useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string;
      input: Omit<StaffDraft, "username" | "password">;
    }) => apiPatch<Staff>(`/settings/staff/${id}`, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["store-staff"] });
      setEditing(null);
      setNotice("Staff profile and permissions updated.");
    },
    onError: (error: Error) =>
      setNotice(error.message || "Could not update staff account."),
  });
  const linkRider = useMutation({
    mutationFn: ({ id, riderId }: { id: string; riderId: string }) =>
      apiPatch<Staff>(`/settings/staff/${id}`, { riderId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["store-staff"] });
      setNotice("Captain account linkage updated and audited.");
    },
    onError: (error: Error) =>
      setNotice(error.message || "Could not update captain linkage."),
  });
  const resetPassword = useMutation({
    mutationFn: ({ id, password }: { id: string; password: string }) =>
      apiPost(`/settings/staff/${id}/reset-password`, { password }),
    onSuccess: () => {
      setDraft((previous) => ({ ...previous, password: "" }));
      setNotice(
        "Password reset. Existing sessions for that staff account were signed out.",
      );
    },
    onError: (error: Error) =>
      setNotice(error.message || "Could not reset password."),
  });
  const createBranch = useMutation({
    mutationFn: () =>
      apiPost<Branch>("/settings/stores", {
        name: branchName,
        code: branchCode,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["branch-memberships"] });
      setBranchName("");
      setBranchCode("");
      setNotice("Branch created. It is now available in the branch selector.");
    },
    onError: (error: Error) =>
      setNotice(error.message || "Could not create the branch."),
  });
  const applyNormalization = useMutation({
    mutationFn: () =>
      apiPost<{
        documentsApplied: number;
        entriesApplied: number;
        ledgerEntriesApplied: number;
        walletEntriesApplied: number;
        cashCloseSnapshotsApplied: number;
        sourceColumnsApplied: number;
        certified?: boolean;
        runId?: string;
        reconciliation?: { status: string; issueCount: number };
      }>("/ops/financial-normalization"),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["financial-normalization"] });
      queryClient.invalidateQueries({ queryKey: ["laundry-reconciliation"] });
      setNotice(
        `Financial normalization applied: ${result.documentsApplied} documents, ${result.entriesApplied} journal entries, ${result.ledgerEntriesApplied} ledger rows, ${result.walletEntriesApplied} wallet rows, ${result.cashCloseSnapshotsApplied} cash closes. ${result.certified ? `Reconciliation certified${result.runId ? ` · ${result.runId}` : ""}.` : "Reconciliation certification unavailable."}`,
      );
    },
    onError: (error: Error) =>
      setNotice(error.message || "Financial normalization was not applied."),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    setNotice("");
    save.mutate();
  }
  function addStaff(event: FormEvent) {
    event.preventDefault();
    setNotice("");
    createStaff.mutate(draft);
  }
  function beginEdit(user: Staff) {
    setEditing(user);
    setDraft({
      username: user.username,
      password: "",
      roles: user.roles,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      phone: user.phone,
      description: user.description,
      riderId: user.riderId || "",
    });
  }
  function saveEdit(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;
    setNotice("");
    const { username: _username, password, ...profile } = draft;
    updateStaff.mutate({ id: editing.id, input: profile });
    if (password) resetPassword.mutate({ id: editing.id, password });
  }
  function addBranch(event: FormEvent) {
    event.preventDefault();
    setNotice("");
    createBranch.mutate();
  }
  function toggleRole(role: Role) {
    setDraft((current) => ({
      ...current,
      roles: current.roles.includes(role)
        ? current.roles.filter((value) => value !== role)
        : [...current.roles, role],
    }));
  }
  async function backup() {
    if (!window.epic) {
      setNotice(
        "Backups are available from the Epic Laundry desktop File menu.",
      );
      return;
    }
    try {
      const result = await window.epic.backup();
      if (result.ok) {
        setBackupHealth(await window.epic.backupStatus());
        saveProgress.mutate({ recovery: true });
        setNotice(`Backup saved${result.path ? ` to ${result.path}` : ""}.`);
        if (window.confirm("Create a passphrase-protected backup too?"))
          await encryptedBackup();
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Backup failed.");
    }
  }
  async function restore() {
    if (!window.epic) {
      setNotice(
        "Restore is available from the Epic Laundry desktop File menu.",
      );
      return;
    }
    try {
      const encrypted = window.confirm(
        "Is this a passphrase-protected .epicbackup file?",
      );
      const result = encrypted
        ? await encryptedRestore()
        : await window.epic.restore();
      if (result?.ok)
        setNotice(
          encrypted
            ? "Encrypted restore complete. The workspace is reloading."
            : "Restore complete. The workspace is reloading.",
        );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Restore failed.");
    }
  }
  async function encryptedBackup() {
    if (!window.epic?.encryptedBackup) {
      setNotice(
        "Encrypted backups are available in the Epic Laundry desktop application.",
      );
      return;
    }
    const passphrase = window.prompt(
      "Create a passphrase for this encrypted backup (12+ characters). It cannot be recovered if lost.",
    );
    if (!passphrase) return;
    const result = await window.epic.encryptedBackup(passphrase);
    if (result.ok) {
      setBackupHealth(await window.epic.backupStatus());
      saveProgress.mutate({ recovery: true });
      setNotice(
        `Encrypted backup saved${result.path ? ` to ${result.path}` : ""}.`,
      );
    }
  }
  async function encryptedRestore() {
    if (!window.epic?.encryptedRestore)
      throw new Error(
        "Encrypted restore is available in the Epic Laundry desktop application.",
      );
    const passphrase = window.prompt(
      "Enter the encrypted backup passphrase. It cannot be recovered if lost.",
    );
    if (!passphrase) return { ok: false };
    return window.epic.encryptedRestore(passphrase);
  }
  async function chooseBackupLocation() {
    if (!window.epic?.chooseBackupLocation) {
      setNotice(
        "A backup destination can be selected from the Epic Laundry desktop application.",
      );
      return;
    }
    try {
      const result = await window.epic.chooseBackupLocation();
      if (result.ok) {
        const next = await window.epic.backupLocation();
        setBackupLocation(next);
        const health = await window.epic.backupStatus();
        setBackupHealth(health);
        setNotice(`Rolling recovery snapshots will be saved to ${next.path}.`);
      }
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Could not configure the backup destination.",
      );
    }
  }
  async function exportDiagnostics() {
    if (!diagnostics.data) {
      setNotice("Diagnostics are still loading.");
      return;
    }
    const content = JSON.stringify(diagnostics.data, null, 2);
    try {
      if (window.epic?.saveFile) {
        const result = await window.epic.saveFile({
          content,
          suggestedName: "epic-laundry-diagnostics.json",
          filters: [
            { name: "JSON", extensions: ["json"] },
            { name: "All Files", extensions: ["*"] },
          ],
        });
        if (result.ok)
          setNotice(
            `Diagnostics saved${result.path ? ` to ${result.path}` : ""}.`,
          );
        return;
      }
      await navigator.clipboard?.writeText(content);
      setNotice("Diagnostics copied to the clipboard.");
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Could not export diagnostics.",
      );
    }
  }
  function selectLogo(file: File | undefined) {
    if (!file) return;
    if (
      !["image/png", "image/jpeg", "image/webp", "image/svg+xml"].includes(
        file.type,
      ) ||
      file.size > 1_000_000
    ) {
      setNotice("Choose a PNG, JPEG, WebP, or SVG logo under 1 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () =>
      setForm((current) => ({
        ...current,
        logoDataUrl: String(reader.result || ""),
      }));
    reader.readAsDataURL(file);
  }

  const checklist = [
    {
      label: "Business profile",
      detail: "Name, phone and address",
      done: Boolean(
        form.businessName.trim() && form.phone.trim() && form.address.trim(),
      ),
      to: "#business-profile",
    },
    {
      label: "Tax configuration",
      detail: form.taxMode === "gst" ? "GSTIN validated" : "Tax mode selected",
      done: form.taxMode === "none" || Boolean(form.gstin.trim()),
      to: "#business-profile",
    },
    {
      label: "Currency and timezone",
      detail: `${form.currency || "INR"} · ${form.timezone || "Asia/Kolkata"}`,
      done: Boolean(/^[A-Z]{3}$/.test(form.currency) && form.timezone),
      to: "#business-profile",
    },
    {
      label: "Printer profile",
      detail: form.printerProfile
        ? "Profile selected"
        : "Select a profile before printing",
      done: Boolean(form.printerProfile),
      to: "#business-profile",
    },
    {
      label: "Catalogue",
      detail: catalogue.data
        ? `${catalogue.data.garments.length} garments · ${catalogue.data.services.length} services`
        : "Loading catalogue status",
      done: Boolean(form.setupProgress?.catalogue),
      to: "/laundry/catalogue",
    },
    {
      label: "Recovery snapshots",
      detail: backupHealth?.healthy
        ? "Latest snapshot verified"
        : "Choose a destination and create a backup",
      done: Boolean(form.setupProgress?.recovery),
      to: "#business-profile",
    },
  ];
  const checklistDone = checklist.filter((item) => item.done).length;

  if (settings.isLoading || staff.isLoading)
    return (
      <div className="grid h-80 place-items-center text-sm text-[#617178]">
        Loading store settings…
      </div>
    );
  if (settings.isError || staff.isError)
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-rose-800">
        Settings could not be loaded. Confirm that your account has owner
        permissions.
      </div>
    );

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 duration-500">
      <p className="text-[10px] font-bold uppercase tracking-[.18em] text-[#4d8982]">
        Owner controls
      </p>
      <h1 className="mt-1 font-serif text-3xl text-[#17353c]">
        Store settings
      </h1>
      <p className="mt-1 text-sm text-[#718087]">
        Profile, payment printing and the people authorised for this branch.
      </p>
      {notice ? (
        <p
          role="status"
          className="mt-4 rounded-xl bg-[#eaf3ef] px-4 py-3 text-sm text-[#236459]"
        >
          {notice}
        </p>
      ) : null}
      <nav aria-label="Settings areas" className="mt-5 rounded-[22px] border border-[#263f44]/10 bg-[#f5f2ff] p-3 shadow-[0_8px_28px_rgba(37,48,43,.03)]">
        <p className="px-1 pb-2 text-[10px] font-extrabold uppercase tracking-[.15em] text-[#767086]">Choose a settings workspace</p>
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Settings workspaces">
          {settingsAreas.map(({ id, label, detail, icon: Icon }) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`settings-tab-${id}`}
              aria-selected={activeArea === id}
              aria-controls={`settings-panel-${id}`}
              onClick={() => setActiveArea(id)}
              className={`group inline-flex min-w-[150px] flex-1 items-center gap-2 rounded-xl px-3 py-2 text-left ring-1 ring-inset transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#664cf0] ${activeArea === id ? "bg-[#241a45] text-white ring-[#241a45] shadow-sm" : "bg-white text-[#241a45] ring-[#664cf0]/10 hover:ring-[#664cf0]/35"}`}
            >
              <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${activeArea === id ? "bg-white/15 text-[#e3ddff]" : "bg-[#eeeaff] text-[#664cf0]"}`}>
                <Icon className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className={`block text-xs font-extrabold ${activeArea === id ? "text-white" : "text-[#241a45]"}`}>{label}</span>
                <span className={`block truncate text-[10px] ${activeArea === id ? "text-[#e3ddff]" : "text-[#767086]"}`}>{detail}</span>
              </span>
            </button>
          ))}
        </div>
      </nav>
      <section id="workspace-setup" className="mt-6 scroll-mt-24 rounded-[22px] border border-[#263f44]/10 bg-white p-5 shadow-[0_8px_28px_rgba(37,48,43,.04)]">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[.15em] text-[#4d8982]">
              First-run readiness
            </p>
            <h2 className="font-serif text-xl text-[#17353c]">
              Finish your workspace setup
            </h2>
            <p className="mt-1 text-xs text-[#718087]">
              These checks are based on persisted settings and verified local
              capabilities.
            </p>
          </div>
          <span
            className={`rounded-full px-3 py-1.5 text-xs font-bold ${checklistDone === checklist.length ? "bg-[#eaf3ef] text-[#2e6a60]" : "bg-[#fff2ce] text-[#855815]"}`}
          >
            {checklistDone}/{checklist.length} complete
          </span>
        </div>
        <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {checklist.map((item) => (
            <div
              key={item.label}
              className="flex items-start gap-2 rounded-xl border border-[#263f44]/8 bg-[#fafbf8] p-3"
            >
              {item.done ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#39786f]" />
              ) : (
                <Circle className="mt-0.5 h-4 w-4 shrink-0 text-[#b7c0bc]" />
              )}
              <div className="min-w-0">
                <p
                  className={`text-xs font-bold ${item.done ? "text-[#2e6a60]" : "text-[#52676b]"}`}
                >
                  {item.label}
                </p>
                <p className="mt-0.5 text-[11px] leading-4 text-[#718087]">
                  {item.detail}
                </p>
                {!item.done && item.to.startsWith("/") ? (
                  <Link
                    to={item.to}
                    className="mt-1 inline-block text-[11px] font-bold text-[#39786f] hover:underline"
                  >
                    Open setup →
                  </Link>
                ) : null}
                {!item.done && item.to.startsWith("#") ? (
                  <a
                    href={item.to}
                    onClick={() => setActiveArea("workspace-setup")}
                    className="mt-1 inline-block text-[11px] font-bold text-[#39786f] hover:underline"
                  >
                    Configure →
                  </a>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </section>
      {activeArea === "workspace-setup" ? <div id="settings-panel-workspace-setup" role="tabpanel" aria-labelledby="settings-tab-workspace-setup" className="mt-6 grid gap-6 2xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-6">
          <form
            id="business-profile"
            onSubmit={submit}
            className="rounded-[22px] border border-[#263f44]/10 bg-white p-6 shadow-[0_8px_28px_rgba(37,48,43,.04)]"
          >
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#eaf3ef] text-[#39786f]">
                <Building2 className="h-5 w-5" />
              </span>
              <div>
                <h2 className="font-serif text-xl text-[#17353c]">
                  Business profile
                </h2>
                <p className="text-xs text-[#718087]">
                  Displayed on local operational documents.
                </p>
              </div>
            </div>
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <Field
                label="Business name"
                value={form.businessName}
                onChange={(businessName) => setForm({ ...form, businessName })}
              />
              <Field
                label="Phone"
                value={form.phone}
                onChange={(phone) => setForm({ ...form, phone })}
              />
              <Field
                label="Email"
                type="email"
                value={form.email}
                onChange={(email) => setForm({ ...form, email })}
              />
              <Field
                label="UPI identifier"
                value={form.upiId}
                placeholder="store@bank"
                onChange={(upiId) => setForm({ ...form, upiId })}
              />
              <label className="text-sm font-semibold text-[#31484d]">
                Tax mode
                <select
                  value={form.taxMode}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      taxMode: event.target.value as Settings["taxMode"],
                    })
                  }
                  className="mt-1.5 h-10 w-full rounded-xl border border-[#17363e]/15 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-[#3a7d78]"
                >
                  <option value="none">No GST registration</option>
                  <option value="gst">GST registered</option>
                </select>
              </label>
              <Field
                label="GSTIN (required for GST mode)"
                value={form.gstin}
                disabled={form.taxMode !== "gst"}
                placeholder="15-character GSTIN"
                onChange={(gstin) =>
                  setForm({ ...form, gstin: gstin.toUpperCase() })
                }
              />
              <label className="text-sm font-semibold text-[#31484d]">
                Currency
                <input
                  value={form.currency}
                  maxLength={3}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      currency: event.target.value.toUpperCase(),
                    })
                  }
                  className="mt-1.5 h-10 w-full rounded-xl border border-[#17363e]/15 px-3 text-sm uppercase outline-none focus:ring-2 focus:ring-[#3a7d78]"
                />
              </label>
              <label className="text-sm font-semibold text-[#31484d]">
                Timezone
                <select
                  value={form.timezone}
                  onChange={(event) =>
                    setForm({ ...form, timezone: event.target.value })
                  }
                  className="mt-1.5 h-10 w-full rounded-xl border border-[#17363e]/15 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-[#3a7d78]"
                >
                  <option value="Asia/Kolkata">Asia/Kolkata (India)</option>
                  <option value="Asia/Dhaka">Asia/Dhaka</option>
                  <option value="Asia/Dubai">Asia/Dubai</option>
                  <option value="UTC">UTC</option>
                </select>
              </label>
              <label className="text-sm font-semibold text-[#31484d]">
                Printer profile
                <select
                  value={form.printerProfile}
                  onChange={(event) =>
                    setForm({ ...form, printerProfile: event.target.value })
                  }
                  className="mt-1.5 h-10 w-full rounded-xl border border-[#17363e]/15 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-[#3a7d78]"
                >
                  <option value="">Not configured</option>
                  <option value="system-default">
                    System dialog · operator verified
                  </option>
                  {form.printerProfiles
                    .filter((profile) => profile.active)
                    .map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.name} · {profile.kind} · {profile.paperWidthMm}{" "}
                        mm
                      </option>
                    ))}
                </select>
              </label>
              <label className="text-sm font-semibold text-[#31484d]">
                After booking
                <select
                  value={form.afterBooking}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      afterBooking: event.target
                        .value as Settings["afterBooking"],
                    })
                  }
                  className="mt-1.5 h-10 w-full rounded-xl border border-[#17363e]/15 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-[#3a7d78]"
                >
                  <option value="ask">Ask via the booking receipt</option>
                  <option value="open-print-centre">
                    Open Print Centre automatically
                  </option>
                  <option value="auto-print">
                    Open native tag print automatically
                  </option>
                  <option value="none">Do not open a print action</option>
                </select>
                <span className="mt-1 block text-[10px] font-normal leading-4 text-[#718087]">
                  Automatic native printing still reports command acceptance;
                  the operator must verify the physical output.
                </span>
              </label>
              <label className="md:col-span-2 text-sm font-semibold text-[#31484d]">
                Address
                <textarea
                  value={form.address}
                  onChange={(event) =>
                    setForm({ ...form, address: event.target.value })
                  }
                  className="mt-1.5 min-h-24 w-full rounded-xl border border-[#17363e]/15 px-3 py-2.5 font-normal outline-none ring-[#3a7d78] focus:ring-2"
                />
              </label>
              <div className="md:col-span-2 rounded-xl border border-dashed border-[#17363e]/20 bg-[#f8f9f6] p-4">
                <div className="flex items-center gap-4">
                  <span className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-xl border border-[#17363e]/10 bg-white text-[#39786f]">
                    {form.logoDataUrl ? (
                      <img
                        src={form.logoDataUrl}
                        alt="Store logo preview"
                        className="h-full w-full object-contain p-1"
                      />
                    ) : (
                      <Building2 className="h-6 w-6" />
                    )}
                  </span>
                  <label className="min-w-0 cursor-pointer text-sm font-semibold text-[#31484d]">
                    <span className="block">Business logo</span>
                    <span className="mt-0.5 block text-xs font-normal text-[#718087]">
                      PNG, JPEG, WebP or SVG · stored locally with this branch.
                    </span>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/svg+xml"
                      onChange={(event) => selectLogo(event.target.files?.[0])}
                      className="mt-2 block max-w-full text-xs font-normal text-[#617178]"
                    />
                  </label>
                  {form.logoDataUrl ? (
                    <button
                      type="button"
                      onClick={() => setForm({ ...form, logoDataUrl: "" })}
                      className="ml-auto text-xs font-semibold text-[#39786f]"
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
            <label className="mt-5 flex cursor-pointer items-center gap-3 rounded-xl bg-[#f5f7f3] p-4 text-sm">
              <input
                checked={form.qrOnPrint}
                onChange={(event) =>
                  setForm({ ...form, qrOnPrint: event.target.checked })
                }
                type="checkbox"
                className="h-4 w-4 accent-[#3a7d78]"
              />
              <span>
                <span className="block font-semibold">
                  Show UPI QR on printed documents
                </span>
                <span className="text-xs text-[#718087]">
                  The QR payload is generated from this store’s own UPI
                  identifier.
                </span>
              </span>
            </label>
            <button
              disabled={save.isPending}
              className="mt-6 inline-flex items-center gap-2 rounded-xl bg-[#123039] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
            >
              <Save className="h-4 w-4" />
              {save.isPending ? "Saving…" : "Save store profile"}
            </button>
          </form>
          <section className="rounded-[22px] border border-[#263f44]/10 bg-white p-6 shadow-[0_8px_28px_rgba(37,48,43,.04)]">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#f7f1e2] text-[#a97420]">
                <UserRound className="h-5 w-5" />
              </span>
              <div>
                <h2 className="font-serif text-xl text-[#17353c]">
                  {editing ? `Edit ${editing.username}` : "Add staff access"}
                </h2>
                <p className="text-xs text-[#718087]">
                  Profiles and permissions are stored only for this branch.
                </p>
              </div>
            </div>
            <form
              autoComplete="off"
              className="mt-6"
              onSubmit={editing ? saveEdit : addStaff}
            >
              <StaffFields
                draft={draft}
                setDraft={setDraft}
                edit={Boolean(editing)}
                onToggleRole={toggleRole}
              />
              <div className="mt-5 flex flex-wrap gap-3">
                <button
                  disabled={
                    createStaff.isPending ||
                    updateStaff.isPending ||
                    resetPassword.isPending
                  }
                  className="inline-flex items-center gap-2 rounded-xl bg-[#39786f] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {editing ? (
                    <Pencil className="h-4 w-4" />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                  {editing ? "Save staff changes" : "Create staff account"}
                </button>
                {editing ? (
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(null);
                      setDraft(blankStaff);
                    }}
                    className="rounded-xl border border-[#17363e]/15 px-4 py-2.5 text-sm font-semibold text-[#31484d]"
                  >
                    Cancel
                  </button>
                ) : null}
              </div>
            </form>
          </section>
        </div>
        <aside className="space-y-6">
          <section className="rounded-[22px] border border-[#263f44]/10 bg-[#123039] p-6 text-[#eaf0e9]">
            <div className="flex items-center gap-3">
              <ShieldCheck className="h-5 w-5 text-[#e6bc65]" />
              <div>
                <h2 className="font-serif text-xl">Store access</h2>
                <p className="text-xs text-[#a8c4bc]">
                  Current branch identities
                </p>
              </div>
            </div>
            <div className="mt-5 space-y-3">
              {staff.data?.map((user) => (
                <StaffCard
                  key={user.id}
                  user={user}
                  onEdit={() => beginEdit(user)}
                  onToggle={() =>
                    setStaffEnabled.mutate({
                      id: user.id,
                      enabled: !user.enabled,
                    })
                  }
                  busy={setStaffEnabled.isPending}
                />
              ))}
            </div>
            <div className="mt-5 flex items-center gap-2 text-xs text-[#a8c4bc]">
              <UsersRound className="h-4 w-4" />
              Epic never returns or persists staff passwords after submission.
            </div>
          </section>
          <section className="rounded-[22px] border border-[#263f44]/10 bg-white p-5 shadow-[0_8px_28px_rgba(37,48,43,.04)]">
            <div className="flex items-center gap-2 text-[#17353c]">
              <MapPinned className="h-5 w-5 text-[#39786f]" />
              <div>
                <h2 className="font-serif text-lg">Branches</h2>
                <p className="text-xs text-[#718087]">
                  Create a separate local operating scope.
                </p>
              </div>
            </div>
            <form onSubmit={addBranch} className="mt-4 space-y-3">
              <Field
                label="Branch name"
                required
                value={branchName}
                onChange={setBranchName}
              />
              <Field
                label="Branch code"
                placeholder="NORTH-01"
                value={branchCode}
                onChange={setBranchCode}
              />
              <button
                disabled={createBranch.isPending}
                className="inline-flex items-center gap-2 rounded-xl bg-[#123039] px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                <Plus className="h-4 w-4" />
                {createBranch.isPending ? "Creating…" : "Create branch"}
              </button>
            </form>
            <div className="mt-4 border-t border-[#17363e]/10 pt-3 text-xs text-[#617178]">
              {branches.data?.map((branch) => (
                <p key={branch.id} className="flex justify-between py-1">
                  <span>{branch.name}</span>
                  <span className="font-mono text-[10px]">{branch.code}</span>
                </p>
              ))}
            </div>
          </section>
          <section className="rounded-[22px] border border-[#263f44]/10 bg-[#eaf3ef] p-5">
            <div className="flex items-center gap-2 text-[#17353c]">
              <HardDrive className="h-5 w-5 text-[#39786f]" />
              <div>
                <h2 className="font-serif text-lg">Data safety</h2>
                <p className="text-xs text-[#617178]">
                  Branch-scoped backup and restore
                </p>
              </div>
            </div>
            <p className="mt-3 text-xs leading-5 text-[#617178]">
              Save a portable JSON snapshot before device migration or restore.
              A safety snapshot is created automatically before replacement.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void backup()}
                className="rounded-lg bg-[#123039] px-3 py-2 text-xs font-bold text-white"
              >
                Backup data
              </button>
              <button
                type="button"
                onClick={() => void restore()}
                className="rounded-lg border border-[#39786f]/30 bg-white px-3 py-2 text-xs font-bold text-[#39786f]"
              >
                Restore data
              </button>
              <button
                type="button"
                onClick={() => void chooseBackupLocation()}
                className="rounded-lg border border-[#39786f]/30 bg-white px-3 py-2 text-xs font-bold text-[#39786f]"
              >
                {backupLocation?.configured
                  ? "Change snapshot folder"
                  : "Choose snapshot folder"}
              </button>
            </div>
            {backupLocation ? (
              <p className="mt-3 break-all text-[11px] leading-4 text-[#587177]">
                Rolling encrypted snapshots:{" "}
                <strong>{backupLocation.path}</strong>
              </p>
            ) : null}
          </section>
          <section className="rounded-[22px] border border-[#263f44]/10 bg-white p-5 shadow-[0_8px_28px_rgba(37,48,43,.04)]">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[.15em] text-[#4d8982]">
                  Supportability
                </p>
                <h2 className="font-serif text-lg text-[#17353c]">
                  Safe diagnostics
                </h2>
              </div>
              <span className="rounded-full bg-[#eaf3ef] px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-[#39786f]">
                {diagnostics.data?.health.status || "checking"}
              </span>
            </div>
            <p className="mt-2 text-xs leading-5 text-[#617178]">
              Export versions, migration checksums, aggregate record counts and
              device capability status for support. Customer data, credentials,
              amounts and paths are excluded.
            </p>
            <button
              type="button"
              onClick={() => void exportDiagnostics()}
              disabled={diagnostics.isLoading}
              className="mt-4 rounded-lg bg-[#123039] px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
            >
              {diagnostics.isLoading ? "Preparing…" : "Export diagnostics"}
            </button>
          </section>
          {qrPreview ? (
            <section className="rounded-[22px] border border-[#263f44]/10 bg-white p-5 text-center shadow-[0_8px_28px_rgba(37,48,43,.04)]">
              <p className="text-[10px] font-bold uppercase tracking-[.15em] text-[#4d8982]">
                UPI print preview
              </p>
              <img
                src={qrPreview}
                alt={`UPI QR for ${form.businessName || "Epic Laundry"}`}
                className="mx-auto mt-3 h-40 w-40 rounded-xl border border-[#17363e]/10 p-2"
              />
              <p className="mt-2 text-xs text-[#617178]">
                {form.qrOnPrint
                  ? "Enabled for future printed invoices."
                  : "Preview only — enable the print toggle to show it on documents."}
              </p>
            </section>
          ) : null}
        </aside>
      </div> : null}
      {activeArea === "operations-setup" ? <div id="settings-panel-operations-setup" role="tabpanel" aria-labelledby="settings-tab-operations-setup" className="mt-6 space-y-6">
      <section id="operations-setup" className="scroll-mt-24 rounded-[22px] border border-[#263f44]/10 bg-white p-6 shadow-[0_8px_28px_rgba(37,48,43,.04)]">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#eaf3ef] text-[#39786f]">
            <HardDrive className="h-5 w-5" />
          </span>
          <div>
            <h2 className="font-serif text-xl text-[#17353c]">
              Production station capacity
            </h2>
            <p className="text-xs text-[#718087]">
              Owner-configured open-task targets used by the live workload view.
              These are planning thresholds, not throughput promises.
            </p>
          </div>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {stationLabels.map((station) => (
            <label
              key={station}
              className="text-sm font-semibold text-[#31484d]"
            >
              {station}
              <input
                type="number"
                min="0"
                max="10000"
                step="1"
                value={form.stationCapacities[station] ?? 0}
                onChange={(event) =>
                  setForm({
                    ...form,
                    stationCapacities: {
                      ...form.stationCapacities,
                      [station]: Math.max(
                        0,
                        Math.min(
                          10000,
                          Math.floor(Number(event.target.value) || 0),
                        ),
                      ),
                    },
                  })
                }
                className="mt-1.5 h-10 w-full rounded-xl border border-[#17363c]/15 bg-white px-3 font-normal outline-none focus:ring-2 focus:ring-[#3a7d78]"
              />
              <span className="mt-1 block text-[10px] font-normal text-[#718087]">
                Open tasks before warning
              </span>
            </label>
          ))}
        </div>
        <button
          type="button"
          disabled={save.isPending}
          onClick={() => save.mutate()}
          className="mt-5 inline-flex items-center gap-2 rounded-xl border border-[#39786f]/30 px-4 py-2.5 text-sm font-semibold text-[#39786f] disabled:opacity-60"
        >
          <Save className="h-4 w-4" />
          Save station targets
        </button>
      </section>
      <ServiceZoneMaster />
      <RackProfileMaster />
      </div> : null}
      {activeArea === "finance-controls" ? <div id="settings-panel-finance-controls" role="tabpanel" aria-labelledby="settings-tab-finance-controls" className="mt-6 space-y-6">
      <section id="finance-controls" className="scroll-mt-24 rounded-[22px] border border-[#263f44]/10 bg-white p-6 shadow-[0_8px_28px_rgba(37,48,43,.04)]">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[.15em] text-[#4d8982]">
              Controlled migration
            </p>
            <h2 className="mt-1 font-serif text-xl text-[#17353c]">
              Financial normalization
            </h2>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-[#718087]">
              Preview legacy money rows before creating normalized paise
              mirrors, ledger entries, wallet rows, constrained source columns,
              and historical cash-close snapshots. Conflicts and invalid amounts
              always block the apply.
            </p>
          </div>
          <span
            className={`rounded-full px-3 py-1.5 text-xs font-bold ${normalization.data && normalization.data.invalid === 0 && normalization.data.conflicts === 0 ? "bg-[#eaf3ef] text-[#2e6a60]" : "bg-[#fff2ce] text-[#855815]"}`}
          >
            {normalization.isLoading
              ? "Checking…"
              : normalization.data &&
                  normalization.data.invalid === 0 &&
                  normalization.data.conflicts === 0
                ? "Ready to review"
                : "Attention required"}
          </span>
        </div>
        {normalization.data ? (
          <>
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
              <Stat
                label="Documents"
                value={String(normalization.data.missingDocuments)}
              />
              <Stat
                label="Journal entries"
                value={String(normalization.data.missingEntries)}
              />
              <Stat
                label="Ledger rows"
                value={String(normalization.data.missingLedgerEntries)}
              />
              <Stat
                label="Wallet rows"
                value={String(normalization.data.missingWalletEntries)}
              />
              <Stat
                label="Cash closes"
                value={String(normalization.data.missingCashCloseSnapshots)}
              />
              <Stat
                label="Source columns"
                value={String(normalization.data.missingSourceColumns)}
              />
              <Stat
                label="Invalid"
                value={String(normalization.data.invalid)}
              />
              <Stat
                label="Conflicts"
                value={String(normalization.data.conflicts)}
              />
            </div>
            {normalization.data.latestCertifiedRun ? (
              <p className="mt-4 rounded-xl bg-[#eaf3ef] px-3 py-2 text-xs text-[#2e6a60]">
                Last certified run {normalization.data.latestCertifiedRun.id} ·{" "}
                {new Date(
                  normalization.data.latestCertifiedRun.createdAt,
                ).toLocaleString("en-IN")}{" "}
                · reconciliation{" "}
                {normalization.data.latestCertifiedRun.reconciliationStatus} (
                {normalization.data.latestCertifiedRun.reconciliationIssueCount}{" "}
                issues).
              </p>
            ) : null}
            {normalization.data.issues.length ||
            normalization.data.conflictDetails.length ? (
              <p className="mt-4 rounded-xl bg-[#fff8e8] px-3 py-2 text-xs text-[#855815]">
                Resolve the listed source or mirror issues before applying this
                migration.
              </p>
            ) : (
              <button
                type="button"
                disabled={
                  applyNormalization.isPending ||
                  normalization.data.missingDocuments +
                    normalization.data.missingEntries +
                    normalization.data.missingLedgerEntries +
                    normalization.data.missingWalletEntries +
                    normalization.data.missingCashCloseSnapshots +
                    normalization.data.missingSourceColumns ===
                    0
                }
                onClick={() => {
                  if (
                    window.confirm(
                      "Apply the reviewed financial normalization to this branch?",
                    )
                  )
                    applyNormalization.mutate();
                }}
                className="mt-4 inline-flex items-center gap-2 rounded-xl bg-[#123039] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
              >
                <ShieldCheck className="h-4 w-4" />
                {applyNormalization.isPending
                  ? "Applying…"
                  : "Apply reviewed normalization"}
              </button>
            )}
          </>
        ) : (
          <p className="mt-4 text-xs text-[#718087]">
            Normalization preview is unavailable until the owner session is
            ready.
          </p>
        )}
      </section>
      <CompatibilityAuditPanel
        audit={compatibility.data}
        loading={compatibility.isLoading}
      />
      <EntityNormalizationPanel />
      <GarmentBackfillPanel />
      </div> : null}
      {activeArea === "printing-setup" ? <div id="settings-panel-printing-setup" role="tabpanel" aria-labelledby="settings-tab-printing-setup" className="mt-6 space-y-6">
        <div id="printing-setup" className="scroll-mt-24">
          <TagTemplateConfiguratorV2
            value={form.tagTemplate}
            onChange={(tagTemplate) => setForm({ ...form, tagTemplate })}
            onSave={() => save.mutate()}
            saving={save.isPending}
          />
        </div>
        <div className="scroll-mt-24">
          <PrinterProfileManager
            profiles={form.printerProfiles}
            onChange={(printerProfiles) => setForm({ ...form, printerProfiles })}
          />
        </div>
      </div> : null}
      {activeArea === "data-safety" ? <div id="settings-panel-data-safety" role="tabpanel" aria-labelledby="settings-tab-data-safety" className="mt-6 space-y-6">
        <div id="data-safety" className="scroll-mt-24">
          <RecoveryRehearsal />
        </div>
        <HardwareStatusPanel />
      {backupHealth ? (
        <section className="mt-5 rounded-[22px] border border-[#263f44]/10 bg-white p-4 shadow-[0_8px_28px_rgba(37,48,43,.04)]">
          <p className="text-[10px] font-bold uppercase tracking-[.15em] text-[#4d8982]">
            Recovery monitor
          </p>
          <p
            className={`mt-1 text-sm font-semibold ${backupHealth.healthy ? "text-[#2e6a60]" : "text-[#9a6518]"}`}
          >
            {backupHealth.healthy
              ? `${backupHealth.encrypted ? "Encrypted" : "Local"} rolling snapshot healthy`
              : "Recovery snapshot needs attention"}
          </p>
          {backupHealth.latest ? (
            <p className="mt-1 text-xs text-[#718087]">
              Latest snapshot:{" "}
              {new Date(backupHealth.latest).toLocaleString("en-IN")}
              {backupHealth.ageHours !== null
                ? ` · ${backupHealth.ageHours.toFixed(1)} hours old`
                : ""}
            </p>
          ) : (
            <p className="mt-1 text-xs text-[#718087]">
              The first automatic snapshot is created on the next scheduled run
              or when the app closes.
            </p>
          )}
          <p className="mt-1 text-xs text-[#718087]">{backupHealth.reason}</p>
        </section>
      ) : null}
      </div> : null}
    </div>
  );
}

function PrinterProfileManager({
  profiles,
  onChange,
}: {
  profiles: PrinterProfile[];
  onChange: (profiles: PrinterProfile[]) => void;
}) {
  const add = () =>
    onChange([
      ...profiles,
      {
        id: `printer-${Date.now()}`,
        name: "New printer profile",
        kind: "tag",
        connection: "system-dialog",
        device: "",
        paperWidthMm: 80,
        paperHeightMm: 80,
        orientation: "portrait",
        marginMm: 5,
        dpi: 203,
        copies: 1,
        silentPrintEnabled: false,
        active: true,
        supportsQr: true,
        supportsBarcode: false,
      },
    ]);
  const update = (id: string, patch: Partial<PrinterProfile>) =>
    onChange(
      profiles.map((profile) =>
        profile.id === id ? { ...profile, ...patch } : profile,
      ),
    );
  return (
    <section className="mt-5 rounded-[22px] border border-[#263f44]/10 bg-white p-6 shadow-[0_8px_28px_rgba(37,48,43,.04)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[.15em] text-[#4d8982]">
            Physical output profiles
          </p>
          <h2 className="mt-1 font-serif text-xl text-[#17353c]">
            Printer profiles
          </h2>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-[#617178]">
            Record the intended device, connection, paper width, and code
            support per branch. A saved profile describes routing; it does not
            claim the device is connected until hardware evidence is recorded.
          </p>
        </div>
        <button
          type="button"
          onClick={add}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#123039] px-3 py-2 text-xs font-bold text-white"
        >
          <Plus className="h-3.5 w-3.5" />
          Add profile
        </button>
      </div>
      {profiles.length ? (
        <div className="mt-4 space-y-3">
          {profiles.map((profile) => (
            <div
              key={profile.id}
              className="rounded-xl border border-[#263f44]/10 bg-[#f8faf7] p-3"
            >
              <div className="grid gap-2 sm:grid-cols-[1.2fr_120px_150px_100px_auto]">
                <input
                  value={profile.name}
                  onChange={(event) =>
                    update(profile.id, { name: event.target.value })
                  }
                  aria-label="Printer profile name"
                  className="h-9 rounded-lg border border-[#263f44]/15 bg-white px-2 text-xs font-semibold"
                />
                <select
                  aria-label="Printer document type"
                  value={profile.kind}
                  onChange={(event) =>
                    update(profile.id, {
                      kind: event.target.value as PrinterProfile["kind"],
                    })
                  }
                  className="h-9 rounded-lg border border-[#263f44]/15 bg-white px-2 text-xs"
                >
                  <option value="tag">Tag</option>
                  <option value="receipt">Receipt</option>
                </select>
                <select
                  aria-label="Printer connection"
                  value={profile.connection}
                  onChange={(event) =>
                    update(profile.id, {
                      connection: event.target
                        .value as PrinterProfile["connection"],
                    })
                  }
                  className="h-9 rounded-lg border border-[#263f44]/15 bg-white px-2 text-xs"
                >
                  <option value="system-dialog">System dialog</option>
                  <option value="usb">USB</option>
                  <option value="network">Network</option>
                  <option value="file">File / PDF</option>
                </select>
                <input
                  type="number"
                  min="25"
                  max="300"
                  value={profile.paperWidthMm}
                  onChange={(event) =>
                    update(profile.id, {
                      paperWidthMm: Number(event.target.value) || 80,
                    })
                  }
                  aria-label="Paper width millimetres"
                  className="h-9 rounded-lg border border-[#263f44]/15 bg-white px-2 text-xs"
                />
                <button
                  type="button"
                  onClick={() =>
                    onChange(
                      profiles.filter(
                        (candidate) => candidate.id !== profile.id,
                      ),
                    )
                  }
                  className="rounded-lg border border-rose-200 bg-white px-2 text-xs font-bold text-rose-700"
                >
                  Remove
                </button>
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-5"><input type="number" min="15" max="300" value={profile.paperHeightMm} onChange={(event) => update(profile.id, { paperHeightMm: Number(event.target.value) || 80 })} aria-label="Paper height millimetres" placeholder="Height mm" className="h-8 rounded-lg border border-[#263f44]/15 bg-white px-2 text-[10px]" /><select aria-label="Printer orientation" value={profile.orientation} onChange={(event) => update(profile.id, { orientation: event.target.value as PrinterProfile["orientation"] })} className="h-8 rounded-lg border border-[#263f44]/15 bg-white px-2 text-[10px]"><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select><input type="number" min="0" max="30" value={profile.marginMm} onChange={(event) => update(profile.id, { marginMm: Number(event.target.value) || 0 })} aria-label="Printer margins millimetres" placeholder="Margin mm" className="h-8 rounded-lg border border-[#263f44]/15 bg-white px-2 text-[10px]" /><input type="number" min="72" max="1200" value={profile.dpi} onChange={(event) => update(profile.id, { dpi: Number(event.target.value) || 203 })} aria-label="Printer DPI" placeholder="DPI" className="h-8 rounded-lg border border-[#263f44]/15 bg-white px-2 text-[10px]" /><input type="number" min="1" max="500" value={profile.copies} onChange={(event) => update(profile.id, { copies: Number(event.target.value) || 1 })} aria-label="Printer copies" placeholder="Copies" className="h-8 rounded-lg border border-[#263f44]/15 bg-white px-2 text-[10px]" /></div>
              <label className="mt-2 inline-flex items-center gap-1.5 text-[10px] font-semibold text-[#617178]"><input type="checkbox" checked={profile.silentPrintEnabled} onChange={(event) => update(profile.id, { silentPrintEnabled: event.target.checked })} className="accent-[#3a7d78]" />Silent print enabled only after external verification</label>
              <div className="mt-2 flex flex-wrap gap-4 text-[10px] font-semibold text-[#617178]">
                <label className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={profile.active}
                    onChange={(event) =>
                      update(profile.id, { active: event.target.checked })
                    }
                    className="accent-[#3a7d78]"
                  />
                  Active for selection
                </label>
                <label className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={profile.supportsQr}
                    onChange={(event) =>
                      update(profile.id, { supportsQr: event.target.checked })
                    }
                    className="accent-[#3a7d78]"
                  />
                  QR
                </label>
                <label className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={profile.supportsBarcode}
                    onChange={(event) =>
                      update(profile.id, {
                        supportsBarcode: event.target.checked,
                      })
                    }
                    className="accent-[#3a7d78]"
                  />
                  Barcode
                </label>
                <input
                  value={profile.device}
                  onChange={(event) =>
                    update(profile.id, { device: event.target.value })
                  }
                  placeholder="Device name / address (optional)"
                  className="h-7 min-w-56 flex-1 rounded-md border border-[#263f44]/15 bg-white px-2 text-[10px]"
                />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-4 rounded-xl bg-[#f5f7f3] p-3 text-xs text-[#718087]">
          No custom profiles saved. The system-dialog option remains available
          as an explicitly unverified fallback.
        </p>
      )}
    </section>
  );
}

function TagTemplateConfiguratorV2({
  value,
  onChange,
  onSave,
  saving,
}: {
  value: TagTemplate;
  onChange: (value: TagTemplate) => void;
  onSave: () => void;
  saving: boolean;
}) {
  const presets: Array<{
    id: TagTemplate["preset"];
    label: string;
    width: number;
    height: number;
    columns: number;
    rows: number;
  }> = [
    {
      id: "a4-4",
      label: "A4 · 4-up",
      width: 96,
      height: 130,
      columns: 2,
      rows: 2,
    },
    {
      id: "a4-6",
      label: "A4 · 6-up",
      width: 96,
      height: 84,
      columns: 2,
      rows: 3,
    },
    {
      id: "a4-8",
      label: "A4 · 8-up",
      width: 96,
      height: 63,
      columns: 2,
      rows: 4,
    },
    {
      id: "a4-10",
      label: "A4 · 10-up",
      width: 88,
      height: 52,
      columns: 2,
      rows: 5,
    },
    {
      id: "thermal-50.8x51.4",
      label: "Thermal · 50.8 × 51.4 mm",
      width: 50.8,
      height: 51.4,
      columns: 1,
      rows: 1,
    },
    {
      id: "thermal-50x25",
      label: "Thermal · 50 × 25 mm",
      width: 50,
      height: 25,
      columns: 1,
      rows: 1,
    },
    {
      id: "custom",
      label: "Custom",
      width: value.widthMm,
      height: value.heightMm,
      columns: value.columns,
      rows: value.rows,
    },
  ];
  const update = (next: Partial<TagTemplate>) =>
    onChange({ ...value, ...next });
  const fields: Array<[keyof TagTemplate, string]> = [
    ["showLogo", "Business logo"],
    ["showStoreName", "Store name"],
    ["showGarment", "Garment name"],
    ["showService", "Service"],
    ["showInvoiceNumber", "Invoice number"],
    ["showOrder", "Order number"],
    ["showOrderDate", "Order date"],
    ["showCustomer", "Customer name"],
    ["showPhone", "Customer phone"],
    ["showDueDate", "Due date"],
    ["showSequence", "Order-wide sequence"],
    ["showTagCode", "Human-readable tag code"],
    ["showNotes", "Care / order notes"],
    ["showExpress", "Express marker"],
    ["showSpecialCare", "Special-care marker"],
  ];
  return (
    <section className="mt-5 rounded-[22px] border border-[#263f44]/10 bg-white p-6 shadow-[0_8px_28px_rgba(37,48,43,.04)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[.15em] text-[#4d8982]">
            Physical document control
          </p>
          <h2 className="mt-1 font-serif text-xl text-[#17353c]">
            Tag template configurator
          </h2>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-[#617178]">
            Choose a paper or thermal profile, control the fields printed on
            every tag, and save one branch-scoped template. Changes stay local
            until you explicitly save them; printer connection is verified
            separately.
          </p>
        </div>
        <span className="rounded-full bg-[#eaf3ef] px-3 py-1.5 text-xs font-bold text-[#2e6a60]">
          Owner controlled
        </span>
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_240px]">
        <div className="space-y-4">
          <label className="block text-sm font-semibold text-[#31484d]">
            Preset
            <select
              value={value.preset}
              onChange={(event) => {
                const preset = presets.find(
                  (item) => item.id === event.target.value,
                )!;
                update({
                  preset: preset.id,
                  widthMm: preset.width,
                  heightMm: preset.height,
                  columns: preset.columns,
                  rows: preset.rows,
                  pageSize: preset.id.startsWith("thermal") ? "thermal" : "A4",
                });
              }}
              className="mt-1.5 h-10 w-full rounded-xl border border-[#17363e]/15 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-[#3a7d78]"
            >
              {presets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
            </select>
          </label>
          <div className="grid gap-3 sm:grid-cols-4">
            <NumberField
              label="Width mm"
              value={value.widthMm}
              disabled={value.preset !== "custom"}
              onChange={(widthMm) => update({ preset: "custom", widthMm })}
            />
            <NumberField
              label="Height mm"
              value={value.heightMm}
              disabled={value.preset !== "custom"}
              onChange={(heightMm) => update({ preset: "custom", heightMm })}
            />
            <NumberField
              label="Columns"
              value={value.columns}
              min={1}
              max={6}
              disabled={value.preset !== "custom"}
              onChange={(columns) => update({ preset: "custom", columns })}
            />
            <NumberField
              label="Rows"
              value={value.rows}
              min={1}
              max={12}
              disabled={value.preset !== "custom"}
              onChange={(rows) => update({ preset: "custom", rows })}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-4">
            <label className="text-xs font-semibold text-[#526368]">
              Page size
              <select
                value={value.pageSize}
                onChange={(event) =>
                  update({
                    pageSize: event.target.value as TagTemplate["pageSize"],
                  })
                }
                className="mt-1 block h-9 w-full rounded-lg border border-[#17363e]/15 bg-white px-2 text-xs"
              >
                <option value="A4">A4 sheet</option>
                <option value="thermal">Thermal roll</option>
              </select>
            </label>
            <label className="text-xs font-semibold text-[#526368]">
              Orientation
              <select
                value={value.orientation}
                onChange={(event) =>
                  update({
                    orientation: event.target
                      .value as TagTemplate["orientation"],
                  })
                }
                className="mt-1 block h-9 w-full rounded-lg border border-[#17363e]/15 bg-white px-2 text-xs"
              >
                <option value="portrait">Portrait</option>
                <option value="landscape">Landscape</option>
              </select>
            </label>
            <NumberField
              label="Margin mm"
              value={value.marginMm}
              min={0}
              max={30}
              onChange={(marginMm) => update({ marginMm })}
            />
            <NumberField
              label="Font scale"
              value={value.fontScale}
              min={0.7}
              max={2}
              onChange={(fontScale) => update({ fontScale })}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-4">
            <NumberField
              label="Line spacing"
              value={value.lineSpacing}
              min={0.8}
              max={2}
              onChange={(lineSpacing) => update({ lineSpacing })}
            />
          </div>
          <label className="block text-sm font-semibold text-[#31484d]">
            Code format
            <select
              value={value.codeFormat}
              onChange={(event) =>
                update({
                  codeFormat: event.target.value as TagTemplate["codeFormat"],
                })
              }
              className="mt-1.5 h-10 w-full rounded-xl border border-[#17363e]/15 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-[#3a7d78]"
            >
              <option value="qr">
                QR only · opaque payload + readable tag footer
              </option>
              <option value="code128">Barcode + human-readable code</option>
              <option value="qr+code128">
                QR + barcode + human-readable code
              </option>
            </select>
          </label>
          <fieldset>
            <legend className="text-sm font-semibold text-[#31484d]">
              Printed fields
            </legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {fields.map(([key, label]) => (
                <label
                  key={String(key)}
                  className="flex items-center gap-2 rounded-lg bg-[#f5f7f3] px-3 py-2 text-xs font-medium text-[#526368]"
                >
                  <input
                    type="checkbox"
                    checked={Boolean(value[key])}
                    onChange={(event) =>
                      update({ [key]: event.target.checked })
                    }
                    className="accent-[#3a7d78]"
                  />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => onChange(defaultTagTemplate)}
              className="rounded-lg border border-[#263f44]/15 bg-white px-3 py-2 text-xs font-bold text-[#617178]"
            >
              Reset to recommended defaults
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={onSave}
              className="inline-flex items-center gap-2 rounded-lg bg-[#123039] px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
            >
              <Save className="h-3.5 w-3.5" />
              {saving ? "Saving…" : "Save tag template"}
            </button>
          </div>
        </div>
        <div className="rounded-xl border border-dashed border-[#9cb5ac] bg-[#fbfcf9] p-4">
          <p className="text-[10px] font-bold uppercase tracking-[.14em] text-[#4d8982]">
            Live preview
          </p>
          <div
            className="mt-3 rounded-lg border border-[#78998f] bg-white p-3"
            style={{
              aspectRatio: `${Math.max(value.widthMm, 1)} / ${Math.max(value.heightMm, 1)}`,
              fontSize: `${value.fontScale}em`,
              lineHeight: value.lineSpacing,
            }}
          >
            <div className="flex items-center justify-between text-[8px] font-black uppercase tracking-wider text-[#39786f]">
              <span className="flex items-center gap-1">
                {value.showLogo ? (
                  <span className="grid h-4 w-4 place-items-center rounded bg-[#123039] text-[6px] text-[#f1ca75]">
                    EL
                  </span>
                ) : null}
                {value.showStoreName ? "Epic Laundry" : "Tag preview"}
              </span>
              {value.showSequence ? <span>1 / 3</span> : null}
            </div>
            <div className="mt-3 flex items-end justify-between gap-2">
              <div>
                {value.showGarment ? (
                  <p className="text-sm font-extrabold text-[#17353c]">
                    Cotton shirt
                  </p>
                ) : null}
                {value.showService ? (
                  <p className="mt-1 text-[9px] text-[#39786f]">Wash & fold</p>
                ) : null}
                {value.showOrder ? (
                  <p className="mt-2 text-[8px] text-[#718087]">
                    EL-20260830-0001
                  </p>
                ) : null}
                {value.showInvoiceNumber ? (
                  <p className="text-[8px] text-[#718087]">INV-0001</p>
                ) : null}
                {value.showOrderDate ? (
                  <p className="text-[8px] text-[#718087]">30 AUG 2026</p>
                ) : null}
                {value.showCustomer ? (
                  <p className="text-[8px] text-[#718087]">Asha Kumar</p>
                ) : null}
                {value.showPhone ? (
                  <p className="text-[8px] text-[#718087]">+91 98765 43210</p>
                ) : null}
                {value.showDueDate ? (
                  <p className="mt-1 text-[8px] font-bold text-[#855815]">
                    DUE 02 SEP
                  </p>
                ) : null}
                {value.showNotes ? (
                  <p className="mt-1 text-[8px] text-[#855815]">
                    Handle with care
                  </p>
                ) : null}
                {value.showExpress ? (
                  <span className="mr-1 inline-block rounded bg-[#fff0c7] px-1 text-[7px] font-bold text-[#855815]">
                    EXPRESS
                  </span>
                ) : null}
                {value.showSpecialCare ? (
                  <span className="inline-block rounded bg-[#fbe8e8] px-1 text-[7px] font-bold text-[#a54d4d]">
                    SPECIAL CARE
                  </span>
                ) : null}
              </div>
              {value.codeFormat !== "code128" ? (
                <div className="grid h-12 w-12 place-items-center border-4 border-[#17353c] text-[7px] font-black text-[#17353c]">
                  QR
                </div>
              ) : null}
            </div>
            {value.showTagCode ? (
              <p className="mt-3 border-t border-[#e4ebe6] pt-2 font-mono text-[8px] text-[#617178]">
                ELT-20260830-000001
              </p>
            ) : null}
            {value.codeFormat !== "qr" ? (
              <p className="mt-1 text-[7px] tracking-[.18em] text-[#17353c]">
                ▌▌▌ ▌▌ ▌▌▌ ▌▌
              </p>
            ) : null}
          </div>
          <p className="mt-3 text-[10px] leading-4 text-[#718087]">
            {value.widthMm} × {value.heightMm} mm · {value.columns} ×{" "}
            {value.rows} grid · {value.orientation} ·{" "}
            {value.codeFormat.toUpperCase()}
          </p>
        </div>
      </div>
    </section>
  );
}

function TagTemplateConfiguratorLegacy({
  value,
  onChange,
  onSave,
  saving,
}: {
  value: TagTemplate;
  onChange: (value: TagTemplate) => void;
  onSave: () => void;
  saving: boolean;
}) {
  const presets: Array<{
    id: TagTemplate["preset"];
    label: string;
    width: number;
    height: number;
    columns: number;
    rows: number;
  }> = [
    {
      id: "a4-4",
      label: "A4 · 4-up",
      width: 96,
      height: 130,
      columns: 2,
      rows: 2,
    },
    {
      id: "a4-6",
      label: "A4 · 6-up",
      width: 96,
      height: 84,
      columns: 2,
      rows: 3,
    },
    {
      id: "a4-8",
      label: "A4 · 8-up",
      width: 96,
      height: 63,
      columns: 2,
      rows: 4,
    },
    {
      id: "a4-10",
      label: "A4 · 10-up",
      width: 88,
      height: 52,
      columns: 2,
      rows: 5,
    },
    {
      id: "thermal-50.8x51.4",
      label: "Thermal · 50.8 × 51.4 mm",
      width: 50.8,
      height: 51.4,
      columns: 1,
      rows: 1,
    },
    {
      id: "thermal-50x25",
      label: "Thermal · 50 × 25 mm",
      width: 50,
      height: 25,
      columns: 1,
      rows: 1,
    },
    {
      id: "custom",
      label: "Custom",
      width: value.widthMm,
      height: value.heightMm,
      columns: value.columns,
      rows: value.rows,
    },
  ];
  const update = (next: Partial<TagTemplate>) =>
    onChange({ ...value, ...next });
  return (
    <section className="mt-5 rounded-[22px] border border-[#263f44]/10 bg-white p-6 shadow-[0_8px_28px_rgba(37,48,43,.04)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[.15em] text-[#4d8982]">
            Physical document control
          </p>
          <h2 className="mt-1 font-serif text-xl text-[#17353c]">
            Tag template configurator
          </h2>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-[#617178]">
            Choose a paper or thermal profile, control the fields printed on
            every tag, and save one branch-scoped template. Preview dimensions
            are physical millimetres; printer connection is still verified
            separately.
          </p>
        </div>
        <span className="rounded-full bg-[#eaf3ef] px-3 py-1.5 text-xs font-bold text-[#2e6a60]">
          Owner controlled
        </span>
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_240px]">
        <div className="space-y-4">
          <label className="block text-sm font-semibold text-[#31484d]">
            Preset
            <select
              value={value.preset}
              onChange={(event) => {
                const preset = presets.find(
                  (item) => item.id === event.target.value,
                )!;
                update({
                  preset: preset.id,
                  widthMm: preset.width,
                  heightMm: preset.height,
                  columns: preset.columns,
                  rows: preset.rows,
                });
              }}
              className="mt-1.5 h-10 w-full rounded-xl border border-[#17363e]/15 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-[#3a7d78]"
            >
              {presets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
            </select>
          </label>
          <div className="grid gap-3 sm:grid-cols-4">
            <NumberField
              label="Width mm"
              value={value.widthMm}
              disabled={value.preset !== "custom"}
              onChange={(widthMm) => update({ preset: "custom", widthMm })}
            />
            <NumberField
              label="Height mm"
              value={value.heightMm}
              disabled={value.preset !== "custom"}
              onChange={(heightMm) => update({ preset: "custom", heightMm })}
            />
            <NumberField
              label="Columns"
              value={value.columns}
              min={1}
              max={6}
              disabled={value.preset !== "custom"}
              onChange={(columns) => update({ preset: "custom", columns })}
            />
            <NumberField
              label="Rows"
              value={value.rows}
              min={1}
              max={12}
              disabled={value.preset !== "custom"}
              onChange={(rows) => update({ preset: "custom", rows })}
            />
          </div>
          <label className="block text-sm font-semibold text-[#31484d]">
            Code format
            <select
              value={value.codeFormat}
              onChange={(event) =>
                update({
                  codeFormat: event.target.value as TagTemplate["codeFormat"],
                })
              }
              className="mt-1.5 h-10 w-full rounded-xl border border-[#17363e]/15 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-[#3a7d78]"
            >
              <option value="qr">QR only · opaque payload</option>
              <option value="code128">
                Code 128 line + human-readable code
              </option>
              <option value="qr+code128">QR + Code 128 line</option>
            </select>
          </label>
          <fieldset>
            <legend className="text-sm font-semibold text-[#31484d]">
              Printed fields
            </legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {(
                [
                  ["showSequence", "Order-wide sequence"],
                  ["showOrder", "Order number"],
                  ["showCustomer", "Customer name"],
                  ["showDueDate", "Due date"],
                ] as const
              ).map(([key, label]) => (
                <label
                  key={key}
                  className="flex items-center gap-2 rounded-lg bg-[#f5f7f3] px-3 py-2 text-xs font-medium text-[#526368]"
                >
                  <input
                    type="checkbox"
                    checked={value[key]}
                    onChange={(event) =>
                      update({ [key]: event.target.checked })
                    }
                    className="accent-[#3a7d78]"
                  />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => onChange(defaultTagTemplate)}
              className="rounded-lg border border-[#263f44]/15 bg-white px-3 py-2 text-xs font-bold text-[#617178]"
            >
              Reset defaults
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={onSave}
              className="inline-flex items-center gap-2 rounded-lg bg-[#123039] px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
            >
              <Save className="h-3.5 w-3.5" />
              {saving ? "Saving…" : "Save tag template"}
            </button>
          </div>
        </div>
        <div className="rounded-xl border border-dashed border-[#9cb5ac] bg-[#fbfcf9] p-4">
          <p className="text-[10px] font-bold uppercase tracking-[.14em] text-[#4d8982]">
            Live preview
          </p>
          <div
            className="mt-3 rounded-lg border border-[#78998f] bg-white p-3"
            style={{
              aspectRatio: `${Math.max(value.widthMm, 1)} / ${Math.max(value.heightMm, 1)}`,
            }}
          >
            <div className="flex items-center justify-between text-[8px] font-black uppercase tracking-wider text-[#39786f]">
              <span>Epic Laundry</span>
              {value.showSequence ? <span>1 / 3</span> : null}
            </div>
            <div className="mt-3 flex items-end justify-between gap-2">
              <div>
                <p className="text-sm font-extrabold text-[#17353c]">
                  Cotton shirt
                </p>
                <p className="mt-1 text-[9px] text-[#39786f]">Wash & fold</p>
                {value.showOrder ? (
                  <p className="mt-2 text-[8px] text-[#718087]">
                    EL-20260830-0001
                  </p>
                ) : null}
                {value.showCustomer ? (
                  <p className="text-[8px] text-[#718087]">Asha Kumar</p>
                ) : null}
                {value.showDueDate ? (
                  <p className="mt-1 text-[8px] font-bold text-[#855815]">
                    DUE 02 SEP
                  </p>
                ) : null}
              </div>
              {value.codeFormat !== "code128" ? (
                <div className="grid h-12 w-12 place-items-center border-4 border-[#17353c] text-[7px] font-black text-[#17353c]">
                  QR
                </div>
              ) : null}
            </div>
            <p className="mt-3 border-t border-[#e4ebe6] pt-2 font-mono text-[8px] text-[#617178]">
              ELT-20260830-000001
            </p>
            {value.codeFormat !== "qr" ? (
              <p className="mt-1 text-[7px] tracking-[.18em] text-[#17353c]">
                ▌▌▌ ▌▌ ▌▌▌ ▌▌
              </p>
            ) : null}
          </div>
          <p className="mt-3 text-[10px] leading-4 text-[#718087]">
            {value.widthMm} × {value.heightMm} mm · {value.columns} ×{" "}
            {value.rows} grid · {value.codeFormat.toUpperCase()}
          </p>
        </div>
      </div>
    </section>
  );
}
function NumberField({
  label,
  value,
  min = 1,
  max = 300,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label className="text-xs font-semibold text-[#526368]">
      {label}
      <input
        type="number"
        min={min}
        max={max}
        step="0.1"
        value={value}
        disabled={disabled}
        onChange={(event) =>
          onChange(
            Math.max(min, Math.min(max, Number(event.target.value) || min)),
          )
        }
        className="mt-1 block h-9 w-full rounded-lg border border-[#17363e]/15 bg-white px-2 text-xs outline-none focus:ring-2 focus:ring-[#3a7d78] disabled:bg-[#f2f4f0]"
      />
    </label>
  );
}

function RecoveryRehearsal() {
  const [report, setReport] = useState<RecoveryRehearsalReport | null>(null);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  useEffect(() => {
    window.epic
      ?.backupStatus?.()
      .then((status) => setReport(status.rehearsal || null))
      .catch(() => setReport(null));
  }, []);
  async function verify() {
    if (!window.epic?.verifyLatestBackup) {
      setMessage(
        "Recovery verification is available in the Epic Laundry desktop application.",
      );
      return;
    }
    setPending(true);
    setMessage("");
    try {
      const next = await window.epic.verifyLatestBackup();
      setReport(next);
      setMessage(
        "Latest recovery snapshot verified without changing workspace data.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Recovery verification failed.",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="mt-5 rounded-[22px] border border-[#263f44]/10 bg-[#f7faf7] p-5 shadow-[0_8px_28px_rgba(37,48,43,.03)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[.15em] text-[#4d8982]">
            Recovery rehearsal
          </p>
          <h2 className="mt-1 font-serif text-lg text-[#17353c]">
            Non-destructive restore verification
          </h2>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-[#617178]">
            The desktop scheduler verifies each automatic snapshot against the
            authenticated restore verifier, then restores it into a brand-new
            isolated SQLite database and compares durable record counts. Live
            workspace data is never replaced.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void verify()}
          disabled={pending}
          className="rounded-xl border border-[#39786f]/30 bg-white px-3 py-2 text-xs font-bold text-[#39786f] disabled:opacity-50"
        >
          {pending ? "Verifying…" : "Verify latest snapshot"}
        </button>
      </div>
      {report ? (
        <>
          <div className="mt-4 grid grid-cols-2 gap-2 text-xs sm:grid-cols-5">
            <div>
              <span className="block text-[10px] uppercase tracking-[.1em] text-[#819095]">
                Snapshot
              </span>
              <strong
                className="mt-1 block truncate text-[#315d57]"
                title={report.snapshot}
              >
                {report.snapshot}
              </strong>
            </div>
            <div>
              <span className="block text-[10px] uppercase tracking-[.1em] text-[#819095]">
                Rows
              </span>
              <strong className="mt-1 block text-[#315d57]">
                {report.rows}
              </strong>
            </div>
            <div>
              <span className="block text-[10px] uppercase tracking-[.1em] text-[#819095]">
                Financial
              </span>
              <strong className="mt-1 block text-[#315d57]">
                {report.financialEntries + report.financialDocuments}
              </strong>
            </div>
            <div>
              <span className="block text-[10px] uppercase tracking-[.1em] text-[#819095]">
                Cash closes
              </span>
              <strong className="mt-1 block text-[#315d57]">
                {report.cashShiftCloses}
              </strong>
            </div>
            <div>
              <span className="block text-[10px] uppercase tracking-[.1em] text-[#819095]">
                Verified
              </span>
              <strong className="mt-1 block text-[#315d57]">
                {new Date(report.verifiedAt).toLocaleString("en-IN")}
              </strong>
            </div>
          </div>
          <div
            className={`mt-3 rounded-xl px-3 py-2 text-xs font-semibold ${report.freshDatabase?.ok && report.freshDatabase.isolatedDatabase ? "bg-[#eaf3ef] text-[#2e6a60]" : "bg-[#fff2ce] text-[#855815]"}`}
          >
            {report.freshDatabase?.ok && report.freshDatabase.isolatedDatabase
              ? `Fresh-database rehearsal passed · ${Object.values(report.freshDatabase.counts).reduce((sum, value) => sum + value, 0)} durable records restored in isolation`
              : "Fresh-database rehearsal has not passed for this snapshot."}
          </div>
        </>
      ) : (
        <p className="mt-4 text-xs text-[#855815]">
          No successful automatic recovery verification has been recorded yet.
          Create or wait for the next scheduled snapshot.
        </p>
      )}
      {message ? (
        <p role="status" className="mt-3 text-xs font-semibold text-[#2e6a60]">
          {message}
        </p>
      ) : null}
    </section>
  );
}

function CompatibilityAuditPanel({
  audit,
  loading,
}: {
  audit?: CompatibilityAudit;
  loading: boolean;
}) {
  return (
    <section className="mt-5 rounded-[22px] border border-[#263f44]/10 bg-white p-5 shadow-[0_8px_28px_rgba(37,48,43,.03)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[.15em] text-[#4d8982]">
            Migration control
          </p>
          <h2 className="mt-1 font-serif text-lg text-[#17353c]">
            Compatibility retirement readiness
          </h2>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-[#617178]">
            Read-only inventory of generic compatibility rows and their
            normalized mirrors. Payloads are never exposed; retirement remains
            blocked until every source is reconciled and a rollback snapshot is
            available.
          </p>
        </div>
        <span
          className={`rounded-full px-3 py-1.5 text-xs font-bold ${audit?.summary.retirementReady ? "bg-[#eaf3ef] text-[#2e6a60]" : "bg-[#fff2ce] text-[#855815]"}`}
        >
          {loading
            ? "Checking…"
            : audit?.summary.retirementReady
              ? "Ready"
              : "Review required"}
        </span>
      </div>
      {audit ? (
        <>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat
              label="Entities"
              value={String(audit.summary.entitiesPresent)}
            />
            <Stat
              label="Generic rows"
              value={String(audit.summary.compatibilityRows)}
            />
            <Stat
              label="Dual-read"
              value={String(audit.summary.dualReadRows)}
            />
            <Stat
              label="Unresolved"
              value={String(audit.summary.unresolvedRows)}
            />
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[620px] text-left text-xs">
              <thead className="text-[10px] uppercase tracking-[.12em] text-[#819095]">
                <tr>
                  <th className="px-2 py-2">Entity</th>
                  <th className="px-2 py-2">Target</th>
                  <th className="px-2 py-2 text-right">Generic</th>
                  <th className="px-2 py-2 text-right">Normalized</th>
                  <th className="px-2 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {audit.items.map((item) => (
                  <tr key={item.entity} className="border-t border-[#263f44]/8">
                    <td className="px-2 py-2 font-semibold text-[#315d57]">
                      {item.entity}
                    </td>
                    <td className="px-2 py-2 text-[#617178]">{item.target}</td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {item.compatibilityRows}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {item.normalizedRows}
                    </td>
                    <td className="px-2 py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${item.status === "dual_read" ? "bg-[#fff2ce] text-[#855815]" : "bg-rose-50 text-rose-700"}`}
                      >
                        {item.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[10px] leading-4 text-[#819095]">
            Updated {new Date(audit.generatedAt).toLocaleString("en-IN")}.{" "}
            {audit.policy}
          </p>
        </>
      ) : (
        <p className="mt-4 text-xs text-[#855815]">
          Compatibility audit is unavailable until the owner session is ready.
        </p>
      )}
    </section>
  );
}

function EntityNormalizationPanel() {
  const queryClient = useQueryClient();
  const customer = useQuery({
    queryKey: ["entity-normalization-preview", "party"],
    queryFn: () =>
      apiGet<EntityNormalizationPreview>(
        "/ops/entity-normalization?entity=party",
      ),
  });
  const order = useQuery({
    queryKey: ["entity-normalization-preview", "laundry_order"],
    queryFn: () =>
      apiGet<EntityNormalizationPreview>(
        "/ops/entity-normalization?entity=laundry_order",
      ),
  });
  const [message, setMessage] = useState("");
  const apply = useMutation({
    mutationFn: async (entity: EntityNormalizationPreview["entity"]) =>
      apiPost<{
        status: string;
        cursor: number;
        total: number;
        applied: number;
        invalid: number;
        done: boolean;
      }>(
        "/ops/entity-normalization",
        { entity, batchSize: 250 },
        {
          idempotencyKey: `entity-normalization-${entity}-${crypto.randomUUID()}`,
        },
      ),
    onSuccess: (result) => {
      queryClient.invalidateQueries({
        queryKey: ["entity-normalization-preview"],
      });
      queryClient.invalidateQueries({
        queryKey: ["compatibility-retirement-audit"],
      });
      setMessage(
        `${result.status === "completed" ? "Migration completed" : "Batch applied"} · ${result.cursor}/${result.total} source rows · ${result.applied} projections written${result.invalid ? ` · ${result.invalid} invalid` : ""}.`,
      );
    },
    onError: (error: Error) =>
      setMessage(error.message || "Entity normalization was not applied."),
  });
  const cards = [
    {
      key: "party" as const,
      label: "Customers",
      description:
        "Convert customer parties into constrained customer records while preserving preferences, consent and source fingerprints.",
      query: customer,
    },
    {
      key: "laundry_order" as const,
      label: "Laundry orders",
      description:
        "Convert orders and line items into typed order projections with integer milli-quantities and paise money fields.",
      query: order,
    },
  ];
  return (
    <section className="mt-5 rounded-[22px] border border-[#d7c38e]/50 bg-[#fffaf0] p-6 shadow-[0_8px_28px_rgba(37,48,43,.03)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[.15em] text-[#9b6d1d]">
            Controlled entity migration
          </p>
          <h2 className="mt-1 font-serif text-xl text-[#17353c]">
            Customer & order projections
          </h2>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-[#75633b]">
            Review payload-free source counts and validation first. Each click
            applies one bounded, resumable batch; the generic compatibility rows
            remain untouched for rollback and reconciliation.
          </p>
        </div>
        <span className="rounded-full bg-[#fff2ce] px-3 py-1.5 text-xs font-bold text-[#855815]">
          Owner only
        </span>
      </div>
      <div className="mt-5 grid gap-3 lg:grid-cols-2">
        {cards.map(({ key, label, description, query }) => {
          const preview = query.data;
          const run = preview?.latestRun;
          const blocked = Boolean(preview?.invalid || !preview?.readyToApply);
          return (
            <div
              key={key}
              className="rounded-xl border border-[#d7c38e]/60 bg-white p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold text-[#315d57]">{label}</h3>
                  <p className="mt-1 text-xs leading-5 text-[#718087]">
                    {description}
                  </p>
                </div>
                <span
                  className={`rounded-full px-2 py-1 text-[10px] font-bold ${preview?.invalid === 0 && preview?.readyToApply ? "bg-[#eaf3ef] text-[#2e6a60]" : "bg-[#fff2ce] text-[#855815]"}`}
                >
                  {query.isLoading
                    ? "Checking…"
                    : preview?.invalid
                      ? `${preview.invalid} invalid`
                      : run?.status === "completed"
                        ? "Completed"
                        : "Ready to review"}
                </span>
              </div>
              {preview ? (
                <>
                  <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Stat label="Source" value={String(preview.sourceCount)} />
                    <Stat
                      label="Normalized"
                      value={String(preview.normalizedCount)}
                    />
                    <Stat label="Valid" value={String(preview.valid)} />
                    <Stat label="Invalid" value={String(preview.invalid)} />
                  </div>
                  {run ? (
                    <p className="mt-3 rounded-lg bg-[#f8f9f6] px-3 py-2 text-[11px] text-[#617178]">
                      Run {run.id.slice(0, 28)}… · {run.status} · cursor{" "}
                      {run.cursor}/{run.total} · {run.applied} written · updated{" "}
                      {new Date(run.updatedAt).toLocaleString("en-IN")}
                    </p>
                  ) : (
                    <p className="mt-3 text-[11px] text-[#617178]">
                      No migration run recorded yet. The first batch is safe to
                      retry with the same source fingerprint.
                    </p>
                  )}
                  {preview.issues.length ? (
                    <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-[11px] font-semibold text-rose-700">
                      Blocked by {preview.issues.length} validation issue
                      {preview.issues.length === 1 ? "" : "s"}; resolve source
                      data before applying.
                    </p>
                  ) : null}
                  <button
                    type="button"
                    disabled={
                      apply.isPending || blocked || run?.status === "completed"
                    }
                    onClick={() => apply.mutate(key)}
                    className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[#9b6d1d] px-3 py-2 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <ShieldCheck className="h-3.5 w-3.5" />
                    {apply.isPending
                      ? "Applying…"
                      : run?.status === "completed"
                        ? "Migration complete"
                        : "Apply next batch"}
                  </button>
                </>
              ) : (
                <p className="mt-4 text-xs text-[#855815]">
                  Preview is unavailable until the owner session is ready.
                </p>
              )}
            </div>
          );
        })}
      </div>
      {message ? (
        <p
          role="status"
          className="mt-4 rounded-xl bg-[#eaf3ef] px-3 py-2 text-xs font-semibold text-[#2e6a60]"
        >
          {message}
        </p>
      ) : null}
    </section>
  );
}

function ServiceZoneMaster() {
  const queryClient = useQueryClient();
  const zones = useQuery({
    queryKey: ["service-zone-master"],
    queryFn: () => apiGet<ServiceZone[]>("/laundry/service-zone-master"),
  });
  const [draft, setDraft] = useState({
    name: "",
    code: "",
    pickupWindow: "",
    deliveryWindow: "",
  });
  const [message, setMessage] = useState("");
  const create = useMutation({
    mutationFn: () =>
      apiPost<ServiceZone>("/laundry/service-zone-master", draft),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["service-zone-master"] });
      queryClient.invalidateQueries({ queryKey: ["laundry-service-zones"] });
      setDraft({ name: "", code: "", pickupWindow: "", deliveryWindow: "" });
      setMessage("Zone added and audited.");
    },
    onError: (error: Error) =>
      setMessage(error.message || "Could not add service zone."),
  });
  const toggle = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      apiPatch<ServiceZone>(`/laundry/service-zone-master/${id}`, { active }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["service-zone-master"] });
      queryClient.invalidateQueries({ queryKey: ["laundry-service-zones"] });
      setMessage("Zone status updated and audited.");
    },
    onError: (error: Error) =>
      setMessage(error.message || "Could not update service zone."),
  });
  function submit(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    create.mutate();
  }
  return (
    <section className="mt-6 rounded-[22px] border border-[#263f44]/10 bg-white p-6 shadow-[0_8px_28px_rgba(37,48,43,.04)]">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#eaf3ef] text-[#39786f]">
          <MapPinned className="h-5 w-5" />
        </span>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[.15em] text-[#4d8982]">
            Dispatch master data
          </p>
          <h2 className="mt-1 font-serif text-xl text-[#17353c]">
            Service zones
          </h2>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-[#718087]">
            Maintain approved pickup and delivery areas for this branch.
            Inactive zones stop appearing in new route suggestions.
          </p>
        </div>
      </div>
      <form onSubmit={submit} className="mt-5 grid gap-3 md:grid-cols-5">
        <Field
          label="Zone name"
          required
          value={draft.name}
          placeholder="North"
          onChange={(name) => setDraft({ ...draft, name })}
        />
        <Field
          label="Code"
          value={draft.code}
          placeholder="NORTH"
          onChange={(code) => setDraft({ ...draft, code })}
        />
        <Field
          label="Pickup window"
          value={draft.pickupWindow}
          placeholder="09:00–12:00"
          onChange={(pickupWindow) => setDraft({ ...draft, pickupWindow })}
        />
        <Field
          label="Delivery window"
          value={draft.deliveryWindow}
          placeholder="16:00–20:00"
          onChange={(deliveryWindow) => setDraft({ ...draft, deliveryWindow })}
        />
        <button
          disabled={create.isPending || !draft.name.trim()}
          className="mt-auto inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-[#39786f] px-3 text-sm font-semibold text-white disabled:opacity-50"
        >
          <Plus className="h-4 w-4" />
          {create.isPending ? "Adding…" : "Add zone"}
        </button>
      </form>
      {message ? (
        <p role="status" className="mt-3 text-xs font-semibold text-[#2e6a60]">
          {message}
        </p>
      ) : null}
      <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {zones.isLoading ? (
          <p className="text-xs text-[#718087]">Loading zone master…</p>
        ) : zones.data?.length ? (
          zones.data.map((zone) => (
            <div
              key={zone.id}
              className="flex items-start justify-between gap-3 rounded-xl border border-[#263f44]/8 bg-[#fafbf8] p-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-[#315d57]">
                  {zone.name}{" "}
                  {zone.code ? (
                    <span className="font-mono text-[10px] text-[#819095]">
                      · {zone.code}
                    </span>
                  ) : null}
                </p>
                <p className="mt-1 text-[10px] text-[#718087]">
                  {zone.pickupWindow || "Pickup window not set"} ·{" "}
                  {zone.deliveryWindow || "Delivery window not set"}
                </p>
              </div>
              <button
                type="button"
                disabled={toggle.isPending}
                onClick={() =>
                  toggle.mutate({ id: zone.id, active: !zone.active })
                }
                className={`shrink-0 rounded-lg px-2.5 py-1.5 text-[10px] font-bold ${zone.active ? "bg-[#eaf3ef] text-[#2e6a60]" : "bg-[#f3f5f1] text-[#718087]"}`}
              >
                {zone.active ? "Active" : "Inactive"}
              </button>
            </div>
          ))
        ) : (
          <p className="text-xs text-[#718087]">
            No approved zones yet. Legacy free-text zones remain readable.
          </p>
        )}
      </div>
    </section>
  );
}

function RackProfileMaster() {
  const queryClient = useQueryClient();
  const profiles = useQuery({
    queryKey: ["rack-profiles"],
    queryFn: () => apiGet<RackProfile[]>("/laundry/rack-profiles"),
  });
  const [draft, setDraft] = useState({ name: "", code: "", capacity: "20" });
  const [message, setMessage] = useState("");
  const create = useMutation({
    mutationFn: () =>
      apiPost<RackProfile>("/laundry/rack-profiles", {
        ...draft,
        capacity: Number(draft.capacity),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rack-profiles"] });
      setDraft({ name: "", code: "", capacity: "20" });
      setMessage("Rack profile added and audited.");
    },
    onError: (error: Error) =>
      setMessage(error.message || "Could not add rack profile."),
  });
  const toggle = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      apiPatch<RackProfile>(`/laundry/rack-profiles/${id}`, { active }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rack-profiles"] });
      queryClient.invalidateQueries({ queryKey: ["rack-occupancy"] });
      setMessage("Rack profile status updated and audited.");
    },
    onError: (error: Error) =>
      setMessage(error.message || "Could not update rack profile."),
  });
  function submit(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    create.mutate();
  }
  return (
    <section className="mt-6 rounded-[22px] border border-[#263f44]/10 bg-white p-6 shadow-[0_8px_28px_rgba(37,48,43,.04)]">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#eaf3ef] text-[#39786f]">
          <Warehouse className="h-5 w-5" />
        </span>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[.15em] text-[#4d8982]">
            Physical inventory master data
          </p>
          <h2 className="mt-1 font-serif text-xl text-[#17353c]">
            Rack & bin profiles
          </h2>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-[#718087]">
            Configure real rack or bin capacities so occupancy can show
            available space and over-capacity warnings. Unconfigured locations
            remain visible without invented capacity.
          </p>
        </div>
      </div>
      <form
        onSubmit={submit}
        className="mt-5 grid gap-3 md:grid-cols-[1.4fr_1fr_1fr_auto]"
      >
        <Field
          label="Location name"
          required
          value={draft.name}
          placeholder="RACK-A-01"
          onChange={(name) => setDraft({ ...draft, name })}
        />
        <Field
          label="Code"
          value={draft.code}
          placeholder="A01"
          onChange={(code) => setDraft({ ...draft, code })}
        />
        <label className="text-sm font-semibold text-[#31484d]">
          Capacity
          <input
            required
            type="number"
            min="1"
            max="100000"
            value={draft.capacity}
            onChange={(event) =>
              setDraft({ ...draft, capacity: event.target.value })
            }
            className="mt-1.5 h-10 w-full rounded-xl border border-[#17363e]/15 px-3 font-normal outline-none focus:ring-2 focus:ring-[#3a7d78]"
          />
          <span className="mt-1 block text-[10px] font-normal text-[#718087]">
            Physical garment slots
          </span>
        </label>
        <button
          disabled={create.isPending || !draft.name.trim()}
          className="mt-auto inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-[#39786f] px-3 text-sm font-semibold text-white disabled:opacity-50"
        >
          <Plus className="h-4 w-4" />
          {create.isPending ? "Adding…" : "Add rack"}
        </button>
      </form>
      {message ? (
        <p role="status" className="mt-3 text-xs font-semibold text-[#2e6a60]">
          {message}
        </p>
      ) : null}
      <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {profiles.isLoading ? (
          <p className="text-xs text-[#718087]">Loading rack profiles…</p>
        ) : profiles.data?.length ? (
          profiles.data.map((profile) => (
            <div
              key={profile.id}
              className="flex items-start justify-between gap-3 rounded-xl border border-[#263f44]/8 bg-[#fafbf8] p-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-[#315d57]">
                  {profile.name}{" "}
                  {profile.code ? (
                    <span className="font-mono text-[10px] text-[#819095]">
                      · {profile.code}
                    </span>
                  ) : null}
                </p>
                <p className="mt-1 text-[10px] text-[#718087]">
                  {profile.capacity} physical slot
                  {profile.capacity === 1 ? "" : "s"}
                </p>
              </div>
              <button
                type="button"
                disabled={toggle.isPending}
                onClick={() =>
                  toggle.mutate({ id: profile.id, active: !profile.active })
                }
                className={`shrink-0 rounded-lg px-2.5 py-1.5 text-[10px] font-bold ${profile.active ? "bg-[#eaf3ef] text-[#2e6a60]" : "bg-[#f3f5f1] text-[#718087]"}`}
              >
                {profile.active ? "Active" : "Inactive"}
              </button>
            </div>
          ))
        ) : (
          <p className="text-xs text-[#718087]">
            No physical rack profiles yet. Occupancy remains count-only until
            one is configured.
          </p>
        )}
      </div>
    </section>
  );
}

function GarmentBackfillPanel() {
  const queryClient = useQueryClient();
  const preview = useQuery({
    queryKey: ["garment-backfill-preview"],
    queryFn: () => apiGet<GarmentBackfillPreview>("/laundry/garment-backfill"),
  });
  const [message, setMessage] = useState("");
  const apply = useMutation({
    mutationFn: () =>
      apiPost<{
        applied: number;
        candidateCount: number;
        skippedNonPhysical: number;
      }>(
        "/laundry/garment-backfill",
        {},
        { idempotencyKey: `garment-backfill-${Date.now()}` },
      ),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["garment-backfill-preview"] });
      queryClient.invalidateQueries({ queryKey: ["hardware-status"] });
      setMessage(
        `${result.applied} historic physical unit${result.applied === 1 ? "" : "s"} migrated. Weight/area lines skipped: ${result.skippedNonPhysical}.`,
      );
    },
    onError: (error: Error) =>
      setMessage(error.message || "Historic garment backfill was not applied."),
  });
  function run() {
    if (!preview.data?.candidateCount) {
      setMessage("No missing piece/pair units were found.");
      return;
    }
    if (preview.data.issueCount) {
      setMessage(
        "Backfill is blocked until every validation issue is resolved.",
      );
      return;
    }
    if (
      window.confirm(
        `Create ${preview.data.candidateCount} durable garment unit${preview.data.candidateCount === 1 ? "" : "s"} from reviewed historic piece/pair lines?`,
      )
    ) {
      setMessage("");
      apply.mutate();
    }
  }
  return (
    <section className="mt-6 rounded-[22px] border border-[#d7c38e]/50 bg-[#fffaf0] p-6 shadow-[0_8px_28px_rgba(37,48,43,.03)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[.15em] text-[#9b6d1d]">
            Traceability migration
          </p>
          <h2 className="mt-1 font-serif text-xl text-[#17353c]">
            Historic garment-unit backfill
          </h2>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-[#75633b]">
            Preview first, then create durable tags only for validated
            Piece/Pair lines. Kilogram and square-foot services remain measured
            quantities and are never converted into invented garments.
          </p>
        </div>
        <button
          type="button"
          onClick={run}
          disabled={
            preview.isLoading ||
            apply.isPending ||
            Boolean(preview.data?.issueCount)
          }
          className="rounded-xl bg-[#9b6d1d] px-3 py-2 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {apply.isPending ? "Migrating…" : "Apply reviewed backfill"}
        </button>
      </div>
      {preview.isLoading ? (
        <p className="mt-4 text-xs text-[#75633b]">Checking legacy orders…</p>
      ) : preview.isError ? (
        <p className="mt-4 text-xs text-rose-700">
          Backfill preview is unavailable for this workspace.
        </p>
      ) : preview.data ? (
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          <Stat
            label="Missing units"
            value={String(preview.data.candidateCount)}
          />
          <Stat
            label="Measured lines skipped"
            value={String(preview.data.skippedNonPhysical)}
          />
          <Stat
            label="Validation issues"
            value={String(preview.data.issueCount)}
          />
        </div>
      ) : null}
      {preview.data?.issueCount ? (
        <p className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
          Resolve {preview.data.issueCount} validation issue
          {preview.data.issueCount === 1 ? "" : "s"} before applying. No partial
          migration will occur.
        </p>
      ) : null}
      {message ? (
        <p role="status" className="mt-3 text-xs font-semibold text-[#6f551d]">
          {message}
        </p>
      ) : null}
    </section>
  );
}

function HardwareStatusPanel() {
  const hardware = useQuery({
    queryKey: ["hardware-status"],
    queryFn: () => apiGet<HardwareStatus[]>("/ops/hardware-status"),
  });
  return (
    <section className="mt-6 rounded-[22px] border border-[#263f44]/10 bg-white p-6 shadow-[0_8px_28px_rgba(37,48,43,.04)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[.15em] text-[#4d8982]">
            Hardware readiness
          </p>
          <h2 className="mt-1 font-serif text-xl text-[#17353c]">
            Device health evidence
          </h2>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-[#718087]">
            Adapter availability is kept separate from recorded receipt
            evidence. Unconfigured devices are never presented as connected.
          </p>
        </div>
        <span className="rounded-full bg-[#f3f5f1] px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-[.1em] text-[#617178]">
          Truthful boundary
        </span>
      </div>
      <div className="mt-5 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {hardware.isLoading ? (
          <p className="text-xs text-[#718087]">Checking device boundaries…</p>
        ) : (
          hardware.data?.map((item) => (
            <div
              key={item.kind}
              className="rounded-xl border border-[#263f44]/8 bg-[#fafbf8] p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-bold capitalize text-[#315d57]">
                  {item.kind.replace("-", " ")}
                </p>
                <span
                  className={`rounded-full px-2 py-1 text-[10px] font-bold ${item.health === "evidence_seen" ? "bg-[#eaf3ef] text-[#2e6a60]" : item.health === "degraded" ? "bg-rose-50 text-rose-700" : item.health === "not_configured" ? "bg-[#f3f5f1] text-[#718087]" : "bg-[#fff2ce] text-[#855815]"}`}
                >
                  {item.health.replace("_", " ")}
                </span>
              </div>
              <p className="mt-1 text-[10px] text-[#718087]">
                {item.adapter} · {item.receiptCount} receipt
                {item.receiptCount === 1 ? "" : "s"}
                {item.lastReceiptAt
                  ? ` · last ${new Date(item.lastReceiptAt).toLocaleString("en-IN")}`
                  : ""}
              </p>
              <p className="mt-1 text-[10px] text-[#819095]">{item.evidence}</p>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-[#fafbf8] p-3">
      <p className="text-[10px] font-bold uppercase tracking-[.1em] text-[#718087]">
        {label}
      </p>
      <p className="mt-1 font-serif text-xl text-[#17353c]">{value}</p>
    </div>
  );
}

function StaffFields({
  draft,
  setDraft,
  edit,
  onToggleRole,
}: {
  draft: StaffDraft;
  setDraft: (value: StaffDraft | ((current: StaffDraft) => StaffDraft)) => void;
  edit: boolean;
  onToggleRole: (role: Role) => void;
}) {
  return (
    <>
      <div className="grid gap-4 md:grid-cols-2">
        <Field
          label="First name"
          value={draft.firstName}
          onChange={(firstName) => setDraft({ ...draft, firstName })}
        />
        <Field
          label="Last name"
          value={draft.lastName}
          onChange={(lastName) => setDraft({ ...draft, lastName })}
        />
        <Field
          label="Email"
          type="email"
          value={draft.email}
          onChange={(email) => setDraft({ ...draft, email })}
        />
        <Field
          label="Phone"
          type="tel"
          value={draft.phone}
          onChange={(phone) => setDraft({ ...draft, phone })}
        />
        <Field
          label="Username"
          autoComplete="off"
          disabled={edit}
          required
          value={draft.username}
          onChange={(username) => setDraft({ ...draft, username })}
        />
        <Field
          label={edit ? "New password (optional)" : "Temporary password"}
          autoComplete="new-password"
          type="password"
          required={!edit}
          minLength={12}
          value={draft.password}
          onChange={(password) => setDraft({ ...draft, password })}
        />
        <label className="md:col-span-2 text-sm font-semibold text-[#31484d]">
          Description / designation
          <textarea
            value={draft.description}
            onChange={(event) =>
              setDraft({ ...draft, description: event.target.value })
            }
            className="mt-1.5 min-h-20 w-full rounded-xl border border-[#17363e]/15 px-3 py-2.5 font-normal outline-none ring-[#3a7d78] focus:ring-2"
          />
        </label>
      </div>
      <fieldset className="mt-5">
        <legend className="text-sm font-semibold text-[#31484d]">
          Operational roles
        </legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {(Object.keys(roleLabels) as Role[]).map((role) => (
            <label
              key={role}
              className="flex cursor-pointer items-center gap-2 rounded-lg border border-[#17363e]/10 px-3 py-2.5 text-sm"
            >
              <input
                checked={draft.roles.includes(role)}
                onChange={() => onToggleRole(role)}
                type="checkbox"
                className="accent-[#39786f]"
              />
              <span>{roleLabels[role]}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {edit ? (
        <p className="mt-3 flex items-center gap-2 text-xs text-[#718087]">
          <KeyRound className="h-3.5 w-3.5" />
          Setting a new password signs this staff member out of every active
          session.
        </p>
      ) : null}
    </>
  );
}

function StaffCard({
  user,
  onEdit,
  onToggle,
  busy,
}: {
  user: Staff;
  onEdit: () => void;
  onToggle: () => void;
  busy: boolean;
}) {
  const name =
    [user.firstName, user.lastName].filter(Boolean).join(" ") || user.username;
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold">{name}</p>
          <p className="mt-0.5 text-xs text-[#a8c4bc]">
            @{user.username}
            {user.description ? ` · ${user.description}` : ""}
          </p>
        </div>
        <span className="text-[10px] uppercase tracking-wider text-[#e6bc65]">
          {user.enabled ? "Active" : "Disabled"}
        </span>
      </div>
      <p className="mt-2 text-xs text-[#a8c4bc]">
        {user.roles.map((role) => roleLabels[role]).join(" · ")}
      </p>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={onEdit}
          className="rounded-lg border border-white/15 px-2.5 py-1.5 text-xs font-semibold hover:bg-white/10"
        >
          Edit
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onToggle}
          className="rounded-lg border border-white/15 px-2.5 py-1.5 text-xs font-semibold hover:bg-white/10 disabled:opacity-50"
        >
          {user.enabled ? "Disable access" : "Enable access"}
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  placeholder,
  onChange,
  type = "text",
  required,
  disabled,
  minLength,
  autoComplete,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
  disabled?: boolean;
  minLength?: number;
  autoComplete?: string;
}) {
  return (
    <label className="text-sm font-semibold text-[#31484d]">
      {label}
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        minLength={minLength}
        autoComplete={autoComplete}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1.5 w-full rounded-xl border border-[#17363e]/15 px-3 py-2.5 font-normal outline-none ring-[#3a7d78] disabled:bg-[#f5f7f3] focus:ring-2"
      />
    </label>
  );
}
