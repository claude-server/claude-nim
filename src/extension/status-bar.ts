// Copyright (c) 2026 Rithika Liyanage (https://github.com/k-rithik04)
// Licensed under the MIT License - see LICENSE for details
import * as vscode from "vscode";

export class StatusBarManager {
  private item: vscode.StatusBarItem;
  private apiKeyItem: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100,
    );
    this.item.command = "nvidia-nim.toggleProxy";
    this.update(false);
    this.item.show();

    this.apiKeyItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      99,
    );
    this.apiKeyItem.command = "nvidia-nim.manage";
    this.updateApiKeyStatus(false);
    this.apiKeyItem.show();
  }

  public update(isRunning: boolean, port?: number, model?: string) {
    if (isRunning) {
      const modelLabel = model ? ` · ${model}` : "";
      this.item.text = `$(radio-tower) NIM${modelLabel}`;
      this.item.tooltip =
        `Claude Code Proxy running on port ${port ?? 3456}` +
        (model ? `\nModel: ${model}` : "") +
        "\nClick to Stop";
      this.item.backgroundColor = undefined;
    } else {
      this.item.text = "$(circle-slash) NIM";
      this.item.tooltip = "Claude Code Proxy is stopped\nClick to Start";
      this.item.backgroundColor = new vscode.ThemeColor(
        "statusBarItem.warningBackground",
      );
    }
  }

  public updateApiKeyStatus(hasKey: boolean) {
    if (hasKey) {
      this.apiKeyItem.text = "$(key) NIM Key";
      this.apiKeyItem.tooltip =
        "NVIDIA NIM API key configured\nClick to manage";
      this.apiKeyItem.backgroundColor = undefined;
    } else {
      this.apiKeyItem.text = "$(warning) NIM Key";
      this.apiKeyItem.tooltip =
        "No NVIDIA NIM API key configured\nClick to add your key";
      this.apiKeyItem.backgroundColor = new vscode.ThemeColor(
        "statusBarItem.warningBackground",
      );
    }
  }

  public dispose() {
    this.item.dispose();
    this.apiKeyItem.dispose();
  }
}
