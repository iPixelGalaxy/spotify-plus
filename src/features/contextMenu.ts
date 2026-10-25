type MenuArguments = Parameters<Spicetify.ContextMenu.OnClickCallback>;
type MenuPredicate = Spicetify.ContextMenu.ShouldAddCallback;
type MenuEntry = { register(): void };
type MenuContext = { props: unknown; trigger?: string; target?: HTMLElement };
type ContextMenuV2 = {
  parseProps(props: unknown): MenuArguments | undefined;
  Item: new (options: {
    children: string;
    leadingIcon?: string;
    disabled?: boolean;
    shouldAdd: (props: unknown, trigger?: string, target?: HTMLElement) => boolean;
    onClick: (context: MenuContext) => void;
  }) => MenuEntry;
  ItemSubMenu: new (options: {
    text: string;
    items: MenuEntry[];
    disabled?: boolean;
    shouldAdd: (props: unknown, trigger?: string, target?: HTMLElement) => boolean;
  }) => MenuEntry;
};

const NOW_PLAYING_SELECTOR =
  "[data-testid='now-playing-widget'], [data-testid='now-playing-widget-v2'], .main-nowPlayingWidget-nowPlaying";
let nowPlayingContext: MenuArguments | undefined;

document.addEventListener(
  "contextmenu",
  () => {
    nowPlayingContext = undefined;
  },
  true
);

function getContextMenuV2() {
  return (Spicetify as typeof Spicetify & { ContextMenuV2?: ContextMenuV2 }).ContextMenuV2;
}

function getMenuArguments(props: unknown, trigger?: string, target?: HTMLElement) {
  const parsed = getContextMenuV2()?.parseProps(props);
  if (parsed) return parsed;

  // Spotify's new Now Playing menu wrapper exposes canToggleCanvas, but no item URI.
  // The same wrapper serves the cover art and song title.
  if (
    trigger !== "right-click" ||
    !(target instanceof HTMLElement) ||
    !target.closest(NOW_PLAYING_SELECTOR)
  ) {
    return undefined;
  }

  if (!nowPlayingContext) {
    const state = Spicetify.Player.data;
    if (!state?.item?.uri) return undefined;
    // Keep actions bound to the item selected when the menu opened, even after a song change.
    nowPlayingContext = [
      [state.item.uri],
      state.item.uid ? [state.item.uid] : undefined,
      state.context?.uri,
    ];
  }

  return nowPlayingContext;
}

function withMenuArguments(shouldAdd: MenuPredicate) {
  return (props: unknown, trigger?: string, target?: HTMLElement) => {
    const args = getMenuArguments(props, trigger, target);
    return Boolean(args && shouldAdd(...args));
  };
}

export function createContextMenuItem(
  name: string,
  onClick: Spicetify.ContextMenu.OnClickCallback,
  shouldAdd: MenuPredicate,
  icon?: string,
  disabled = false
): MenuEntry {
  const api = getContextMenuV2();
  if (!api) {
    return new Spicetify.ContextMenu.Item(name, onClick, shouldAdd, icon as Spicetify.Icon, disabled);
  }

  return new api.Item({
    children: name,
    leadingIcon: icon,
    disabled,
    shouldAdd: withMenuArguments(shouldAdd),
    onClick: ({ props, trigger, target }) => {
      const args = getMenuArguments(props, trigger, target);
      if (args) onClick(...args);
    },
  });
}

export function createContextMenuSubMenu(
  name: string,
  items: MenuEntry[],
  shouldAdd: MenuPredicate,
  disabled = false
): MenuEntry {
  const api = getContextMenuV2();
  if (!api) {
    return new Spicetify.ContextMenu.SubMenu(
      name,
      items as Spicetify.ContextMenu.Item[],
      shouldAdd,
      disabled
    );
  }

  return new api.ItemSubMenu({
    text: name,
    items,
    disabled,
    shouldAdd: withMenuArguments(shouldAdd),
  });
}
