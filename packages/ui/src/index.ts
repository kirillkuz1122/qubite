/** @qubite/ui — компоненты и токены направления «Частицы» (D-154…D-166). */
export {
  PALETTES,
  COLOR_USAGE,
  COMPANION_COLOR,
  type ColorName,
  type CompanionKind,
  type Palette,
  type ThemeName,
} from './tokens';
export {
  LookProvider,
  useLook,
  loadLook,
  resolveTheme,
  paletteMap,
  DEFAULT_LOOK,
  LOOK_STORE,
  type Look,
  type ThemeChoice,
} from './look';
export { useSpring } from './useSpring';
export { useFlow, type FlowHandle } from './Flow';
export { Button, type ButtonProps } from './Button';
export { Segmented, type SegmentedProps } from './Segmented';
export { Switch, type SwitchProps } from './Switch';
export { RingCheck, type RingCheckProps } from './RingCheck';
export { Command, type CommandProps } from './Command';
export {
  parseCommand,
  COMMAND_OWNER,
  COMMAND_COLOR,
  type ParsedCommand,
  type CommandKind,
} from './command';
export { DotIcon, ICON_NAMES, type IconName } from './icons';
export { DotText, type DotTextProps } from './DotText';
export { Companion, type CompanionHandle, type CompanionProps } from './Companion';
export {
  DotEngine,
  recolorAll,
  KINDS,
  type Body,
  type Dot,
  type Mood,
  type TextGroup,
} from './dots/engine';
export { dotLook } from './dots/look';
export { textCells } from './dots/text';
export { focusOn, caretPoint } from './dots/attention';
export { themeWave } from './wave';
