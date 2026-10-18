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
  type MotionChoice,
  type ThemeChoice,
} from './look';
export {
  FEELS,
  FEEL_NAMES,
  FEEL_LABEL,
  FEEL_PART_LABEL,
  DEFAULT_FEEL,
  feelOf,
  type FeelChoice,
  type FeelName,
  type FeelPart,
} from './feel';
export { useSpring } from './useSpring';
export { useFlow, type FlowHandle, type FlowOptions } from './Flow';
export { useSlide, type SlideHandle } from './Slide';
export { usePress } from './press';
export { useFlip } from './flip';
export { Presence, type PresenceProps } from './Presence';
export { useLeaving, type Leaving } from './leaving';
export { EdgeScroll, type EdgeScrollProps } from './EdgeScroll';
export { flyDot } from './fly';
export { useMedia, WIDE, typewriter } from './media';
export { DotGrid, gridImage } from './DotGrid';
export { Range, type RangeProps } from './Range';
export { PlusMenu, type PlusItem, type PlusMenuProps } from './PlusMenu';
export { Dock, type DockProps, type NavItem } from './Dock';
export { SideNav, type SideNavProps } from './SideNav';
export { CommandSuggest, type CommandSuggestProps } from './CommandSuggest';
export { ExpandPage, type ExpandPageProps, type Rect } from './ExpandPage';
export { Crew, type CrewHandle, type CrewProps } from './Crew';
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
  companionSize,
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
