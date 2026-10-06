import {
  IconBookmark as TablerIconBookmark,
  IconCheck as TablerIconCheck,
  IconChevronDown as TablerIconChevronDown,
  IconChevronRight as TablerIconChevronRight,
  IconChevronUp as TablerIconChevronUp,
  IconClock as TablerIconClock,
  IconExternalLink as TablerIconExternalLink,
  IconLoader2 as TablerIconLoader2,
  IconPencil as TablerIconPencil,
  IconPlus as TablerIconPlus,
  IconRss as TablerIconRss,
  IconSearch as TablerIconSearch,
  IconStar as TablerIconStar,
  IconTrash as TablerIconTrash,
  IconX as TablerIconX,
  IconSelector as TablerIconSelector,
} from "@tabler/icons-react";

function at16(Icon) {
  const Sized = (props) => <Icon size={16} {...props} />;
  Sized.displayName = Icon.displayName || Icon.name;
  return Sized;
}

export const IconBookmark = at16(TablerIconBookmark);
export const IconCheck = at16(TablerIconCheck);
export const IconChevronDown = at16(TablerIconChevronDown);
export const IconChevronRight = at16(TablerIconChevronRight);
export const IconChevronUp = at16(TablerIconChevronUp);
export const IconClock = at16(TablerIconClock);
export const IconExternalLink = at16(TablerIconExternalLink);
export const IconLoader2 = at16(TablerIconLoader2);
export const IconPencil = at16(TablerIconPencil);
export const IconPlus = at16(TablerIconPlus);
export const IconRss = at16(TablerIconRss);
export const IconSearch = at16(TablerIconSearch);
export const IconStar = at16(TablerIconStar);
export const IconTrash = at16(TablerIconTrash);
export const IconX = at16(TablerIconX);
export const IconSelector = at16(TablerIconSelector);
