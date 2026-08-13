interface ShapeSliderProps {
	readonly id: string;
	readonly label: string;
	readonly value: number;
	readonly onChange: (value: number) => void;
	readonly minLabel: string;
	readonly midLabel?: string;
	readonly maxLabel: string;
}

/**
 * A plain native `<input type="range">`, styled -- not a custom drag
 * implementation. Excalidraw's own equivalent (packages/excalidraw/
 * components/Range.tsx) hand-computes a gradient fill and a floating value
 * bubble; the native element already gives full keyboard support (arrow
 * keys, Home/End, screen-reader value announcement) for free, so this stays
 * a thin Tailwind skin over it rather than reimplementing that.
 */
export function ShapeSlider({ id, label, value, onChange, minLabel, midLabel, maxLabel }: ShapeSliderProps): React.JSX.Element {
	return (
		<div className="flex flex-col gap-1.5">
			<div className="flex items-baseline justify-between">
				<label htmlFor={id} className="text-sm font-medium text-gray-900 dark:text-gray-100">
					{label}
				</label>
				<span className="text-xs tabular-nums text-gray-500 dark:text-gray-400">{Math.round(value)}</span>
			</div>
			<input
				id={id}
				type="range"
				min={0}
				max={100}
				step={1}
				value={value}
				onChange={(event) => onChange(Number(event.target.value))}
				className="h-2 w-full cursor-pointer accent-accent"
			/>
			<div className="flex justify-between text-[11px] text-gray-500 dark:text-gray-400">
				<span>{minLabel}</span>
				{midLabel !== undefined && <span>{midLabel}</span>}
				<span>{maxLabel}</span>
			</div>
		</div>
	);
}
