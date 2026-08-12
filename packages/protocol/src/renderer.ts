/**
 * Host-native projection of a semantic view model -- the contract every
 * renderer package (`@zodiac/react`'s components, a future TUI
 * renderer) implements. Deliberately generic over its own render-result
 * type: React returns a `ReactNode`, a TUI renderer returns whatever
 * Malevich/pi-tui expects, a test double can return plain data. This
 * package never imports either -- only the shape every one of them shares.
 */
export interface SurfaceRenderer<TView, TRendered> {
	readonly rendererKind: string;
	render(view: TView): TRendered;
}
