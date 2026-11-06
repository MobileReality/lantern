export interface KeyBinding {
  key: string;
  command: string;
}

interface BaseSetting {
  description: string;
  order?: number;
}

export interface BooleanSetting extends BaseSetting {
  type: 'boolean';
  default: boolean;
}

export interface StringSetting extends BaseSetting {
  type: 'string';
  default: string;
  // Declare enum lists `as const`: SettingValue derives the value type from the literals, otherwise it silently types as string.
  enum?: readonly string[];
  previewable?: boolean;
  presentation?: 'placement';
}

export interface NumberSetting extends BaseSetting {
  type: 'number';
  default: number;
  minimum?: number;
  maximum?: number;
}

export interface BindingsSetting extends BaseSetting {
  type: 'bindings';
  default: readonly KeyBinding[];
}

export type SettingSchema = BooleanSetting | StringSetting | NumberSetting | BindingsSetting;

export interface SettingsNode {
  id: string;
  title: string;
  order?: number;
  properties: Record<string, SettingSchema>;
}
