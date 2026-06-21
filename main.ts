import { App, Modal, Notice, Plugin, PluginSettingTab, Setting, normalizePath, setIcon } from "obsidian";
import { spawn } from "child_process";
import { existsSync } from "fs";

interface VaultOrganizerSettings {
	scriptPath: string;
	vaultOverride: string;
	scheduledTimeEnabled: boolean;
	scheduledTime: string;
	intervalEnabled: boolean;
	intervalMinutes: number;
	chatScriptContent: string;
	wordThreshold: number;
	gitBashPath: string;
}

const DEFAULT_CHAT_SCRIPT = `#!/usr/bin/env bash
PROMPT="$(cat)"
kiro-cli chat --no-interactive --trust-all-tools "\${PROMPT}"
`;

const DEFAULT_SETTINGS: VaultOrganizerSettings = {
	scriptPath: "",
	vaultOverride: "",
	scheduledTimeEnabled: true,
	scheduledTime: "06:00",
	intervalEnabled: false,
	intervalMinutes: 60,
	chatScriptContent: DEFAULT_CHAT_SCRIPT,
	wordThreshold: 500,
	gitBashPath: "",
};

class VaultOrganizerSettingTab extends PluginSettingTab {
	plugin: VaultOrganizerPlugin;

	constructor(app: App, plugin: VaultOrganizerPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl("h2", { text: "Vault Organizer" });

		new Setting(containerEl)
			.setName("organize.sh 경로")
			.setDesc("비워두면 .obsidian/vault-organizer/organize.sh 사용")
			.addText(t => t
				.setPlaceholder("/path/to/organize.sh")
				.setValue(this.plugin.settings.scriptPath)
				.onChange(async v => { this.plugin.settings.scriptPath = v; await this.plugin.saveSettings(); }));

		new Setting(containerEl)
			.setName("Vault 경로 override")
			.setDesc("비워두면 현재 vault 경로 사용")
			.addText(t => t
				.setPlaceholder("")
				.setValue(this.plugin.settings.vaultOverride)
				.onChange(async v => { this.plugin.settings.vaultOverride = v; await this.plugin.saveSettings(); }));

		new Setting(containerEl).setName("AI 백엔드").setHeading();

		const chatSetting = new Setting(containerEl)
			.setName("chat.sh 내용")
			.setDesc("stdin으로 프롬프트 받고 stdout으로 결과 출력. 변경 후 blur 시 chat.sh에 저장.");
		const textarea = chatSetting.controlEl.createEl("textarea");
		textarea.value = this.plugin.settings.chatScriptContent;
		textarea.rows = 7;
		textarea.style.cssText = "width:100%;font-family:monospace;font-size:12px;";
		textarea.addEventListener("change", async () => {
			this.plugin.settings.chatScriptContent = textarea.value;
			await this.plugin.saveSettings();
			await this.plugin.saveChatScript();
		});

		new Setting(containerEl).setName("파일 분할").setHeading();

		new Setting(containerEl)
			.setName("단어 수 임계값")
			.setDesc("초과 시 AI에게 분할 권장 (기본: 500)")
			.addText(t => t
				.setPlaceholder("500")
				.setValue(String(this.plugin.settings.wordThreshold))
				.onChange(async v => {
					const n = parseInt(v);
					if (!isNaN(n) && n > 0) {
						this.plugin.settings.wordThreshold = n;
						await this.plugin.saveSettings();
					}
				}));

		if (process.platform === "win32") {
			new Setting(containerEl).setName("Windows").setHeading();
			new Setting(containerEl)
				.setName("Git Bash 경로")
				.setDesc("자동 감지 실패 시 입력")
				.addText(t => t
					.setPlaceholder("C:\\Program Files\\Git\\bin\\bash.exe")
					.setValue(this.plugin.settings.gitBashPath)
					.onChange(async v => {
						this.plugin.settings.gitBashPath = v;
						await this.plugin.saveSettings();
					}));
		}

		new Setting(containerEl).setName("지정 시각 스케줄").setHeading();

		new Setting(containerEl)
			.setName("활성화")
			.addToggle(t => t
				.setValue(this.plugin.settings.scheduledTimeEnabled)
				.onChange(async v => {
					this.plugin.settings.scheduledTimeEnabled = v;
					await this.plugin.saveSettings();
					this.plugin.restartSchedulers();
				}));

		new Setting(containerEl)
			.setName("실행 시각 (HH:MM)")
			.addText(t => t
				.setPlaceholder("06:00")
				.setValue(this.plugin.settings.scheduledTime)
				.onChange(async v => {
					this.plugin.settings.scheduledTime = v;
					await this.plugin.saveSettings();
					this.plugin.restartSchedulers();
				}));

		new Setting(containerEl).setName("인터벌 스케줄").setHeading();

		new Setting(containerEl)
			.setName("활성화")
			.addToggle(t => t
				.setValue(this.plugin.settings.intervalEnabled)
				.onChange(async v => {
					this.plugin.settings.intervalEnabled = v;
					await this.plugin.saveSettings();
					this.plugin.restartSchedulers();
				}));

		new Setting(containerEl)
			.setName("인터벌 (분)")
			.addText(t => t
				.setPlaceholder("60")
				.setValue(String(this.plugin.settings.intervalMinutes))
				.onChange(async v => {
					const n = parseInt(v);
					if (!isNaN(n) && n > 0) {
						this.plugin.settings.intervalMinutes = n;
						await this.plugin.saveSettings();
						this.plugin.restartSchedulers();
					}
				}));

		new Setting(containerEl)
			.setName("수동 실행")
			.addButton(b => b
				.setButtonText("지금 실행")
				.setCta()
				.onClick(() => this.plugin.runOrganize()));
	}
}

export default class VaultOrganizerPlugin extends Plugin {
	settings: VaultOrganizerSettings;
	isRunning = false;

	private ribbonIconEl: HTMLElement;
	private statusBarEl: HTMLElement;
	private scheduledTimer: ReturnType<typeof setTimeout> | null = null;
	private intervalTimer: ReturnType<typeof setInterval> | null = null;
	private countdownTimer: ReturnType<typeof setInterval> | null = null;

	async onload() {
		await this.loadSettings();

		// 기본 scriptPath: .obsidian/vault-organizer/organize.sh
		if (!this.settings.scriptPath) {
			const base = (this.app.vault.adapter as any).basePath;
			this.settings.scriptPath = normalizePath(base + "/.obsidian/vault-organizer/organize.sh");
		}

		this.addSettingTab(new VaultOrganizerSettingTab(this.app, this));

		// 리본 아이콘
		this.ribbonIconEl = this.addRibbonIcon("file-stack", "Vault Organizer: Run Now", () => {
			this.runOrganize();
		});

		// 상태바
		this.statusBarEl = this.addStatusBarItem();
		this.statusBarEl.style.cursor = "pointer";
		this.statusBarEl.addEventListener("click", () => this.runOrganize());

		// Command Palette
		this.addCommand({
			id: "run-now",
			name: "Run Now",
			callback: () => this.runOrganize(),
		});
		this.addCommand({
			id: "toggle-scheduled",
			name: "Toggle Scheduled Time",
			callback: async () => {
				this.settings.scheduledTimeEnabled = !this.settings.scheduledTimeEnabled;
				await this.saveSettings();
				this.restartSchedulers();
				new Notice(`Scheduled time ${this.settings.scheduledTimeEnabled ? "enabled" : "disabled"}`);
			},
		});
		this.addCommand({
			id: "toggle-interval",
			name: "Toggle Interval",
			callback: async () => {
				this.settings.intervalEnabled = !this.settings.intervalEnabled;
				await this.saveSettings();
				this.restartSchedulers();
				new Notice(`Interval ${this.settings.intervalEnabled ? "enabled" : "disabled"}`);
			},
		});

		this.restartSchedulers();
		this.startCountdown();
		this.updateStatusBar();
	}

	onunload() {
		if (this.scheduledTimer) clearTimeout(this.scheduledTimer);
		if (this.intervalTimer) clearInterval(this.intervalTimer);
		if (this.countdownTimer) clearInterval(this.countdownTimer);
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async saveChatScript(): Promise<void> {
		const base = (this.app.vault.adapter as any).basePath;
		const chatPath = normalizePath(base + "/.obsidian/vault-organizer/chat.sh");
		await this.app.vault.adapter.write(chatPath, this.settings.chatScriptContent);
	}

	private getShell(): string {
		if (process.platform !== "win32") return "bash";
		if (this.settings.gitBashPath && existsSync(this.settings.gitBashPath))
			return this.settings.gitBashPath;
		const candidates = [
			"C:\\Program Files\\Git\\bin\\bash.exe",
			"C:\\Program Files (x86)\\Git\\bin\\bash.exe",
			(process.env["ProgramFiles"] ?? "") + "\\Git\\bin\\bash.exe",
		];
		for (const p of candidates) if (existsSync(p)) return p;
		throw new Error("Git Bash not found. Please set Git Bash path in settings.");
	}

	async runOrganize(): Promise<void> {
		if (this.isRunning) return;
		this.isRunning = true;

		setIcon(this.ribbonIconEl, "loader");
		this.ribbonIconEl.addClass("vault-organizer-loading");
		this.ribbonIconEl.setAttribute("aria-label", "실행 중...");
		this.statusBarEl.setText("🗂 실행 중...");

		const vaultPath = this.settings.vaultOverride ||
			(this.app.vault.adapter as any).basePath;

		const env: NodeJS.ProcessEnv = {
			...process.env,
			OBSIDIAN_VAULT: vaultPath,
			WORD_THRESHOLD: String(this.settings.wordThreshold),
		};

		const scriptPath = this.settings.scriptPath ||
			normalizePath(vaultPath + "/.obsidian/vault-organizer/organize.sh");

		let stderr = "";

		await new Promise<void>((resolve) => {
			const shell = this.getShell();
			const child = spawn(shell, [scriptPath], { env });
			child.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });
			child.on("close", (code: number | null) => {
				this.ribbonIconEl.removeClass("vault-organizer-loading");
				if (code === 0) {
					setIcon(this.ribbonIconEl, "check");
					this.ribbonIconEl.setAttribute("aria-label", "완료");
					new Notice("Vault Organizer: 정리 완료");
				} else {
					setIcon(this.ribbonIconEl, "x");
					this.ribbonIconEl.setAttribute("aria-label", "실패");
					new Notice("Vault Organizer 실패: " + stderr.slice(0, 200));
				}
				setTimeout(() => {
					setIcon(this.ribbonIconEl, "file-stack");
					this.ribbonIconEl.setAttribute("aria-label", "Vault Organizer: Run Now");
					this.updateStatusBar();
				}, 2000);
				resolve();
			});
			child.on("error", (err: Error) => {
				this.ribbonIconEl.removeClass("vault-organizer-loading");
				setIcon(this.ribbonIconEl, "x");
				new Notice("Vault Organizer 실행 오류: " + err.message);
				setTimeout(() => {
					setIcon(this.ribbonIconEl, "file-stack");
					this.ribbonIconEl.setAttribute("aria-label", "Vault Organizer: Run Now");
					this.updateStatusBar();
				}, 2000);
				resolve();
			});
		});

		this.isRunning = false;
	}

	// 다음 HH:MM까지 남은 ms
	private millisUntil(hhmm: string): number {
		const [h, m] = hhmm.split(":").map(Number);
		const now = new Date();
		const target = new Date(now);
		target.setHours(h, m, 0, 0);
		if (target <= now) target.setDate(target.getDate() + 1);
		return target.getTime() - now.getTime();
	}

	private scheduleNext() {
		if (this.scheduledTimer) clearTimeout(this.scheduledTimer);
		if (!this.settings.scheduledTimeEnabled) return;
		const ms = this.millisUntil(this.settings.scheduledTime);
		this.scheduledTimer = setTimeout(() => {
			this.runOrganize();
			this.scheduleNext();
		}, ms);
	}

	private startInterval() {
		if (this.intervalTimer) clearInterval(this.intervalTimer);
		if (!this.settings.intervalEnabled) return;
		this.intervalTimer = setInterval(() => this.runOrganize(), this.settings.intervalMinutes * 60_000);
	}

	private startCountdown() {
		if (this.countdownTimer) clearInterval(this.countdownTimer);
		this.countdownTimer = setInterval(() => this.updateStatusBar(), 60_000);
	}

	restartSchedulers() {
		if (this.scheduledTimer) { clearTimeout(this.scheduledTimer); this.scheduledTimer = null; }
		if (this.intervalTimer) { clearInterval(this.intervalTimer); this.intervalTimer = null; }
		this.scheduleNext();
		this.startInterval();
		this.updateStatusBar();
	}

	updateStatusBar() {
		if (this.isRunning) { this.statusBarEl.setText("🗂 실행 중..."); return; }

		const candidates: number[] = [];
		if (this.settings.scheduledTimeEnabled) candidates.push(this.millisUntil(this.settings.scheduledTime));
		if (this.settings.intervalEnabled) candidates.push(this.settings.intervalMinutes * 60_000);

		if (candidates.length === 0) { this.statusBarEl.setText("🗂 Organizer (수동)"); return; }

		const minMs = Math.min(...candidates);
		const totalMin = Math.floor(minMs / 60_000);
		const h = Math.floor(totalMin / 60);
		const m = totalMin % 60;
		const label = this.settings.scheduledTimeEnabled ? this.settings.scheduledTime : `${h}h ${m}m 후`;
		const countdown = h > 0 ? `${h}h ${m}m` : `${m}m`;
		this.statusBarEl.setText(`🗂 다음: ${label} (${countdown})`);
	}
}
