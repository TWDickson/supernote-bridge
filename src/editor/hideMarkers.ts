import { type EditorState, type Extension, RangeSetBuilder, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";
import { editorLivePreviewField } from "obsidian";

/** The page markers the sync writes around each page's text. */
export const MARKER_LINE = /^%% sn:(?:page id=\S+ hash=[0-9a-f]+|end) %%$/;

const hidden = Decoration.replace({ block: true });

/** Marker lines to hide, as document ranges: every marker line in Live
 *  Preview, except those the selection touches, so selecting or searching
 *  across one shows it. */
export function markerRanges(doc: string, selections: ReadonlyArray<{ from: number; to: number }>): Array<{ from: number; to: number }> {
	const ranges: Array<{ from: number; to: number }> = [];
	let from = 0;
	for (const line of doc.split("\n")) {
		const to = from + line.length;
		if (MARKER_LINE.test(line) && !selections.some((s) => s.from <= to && s.to >= from)) ranges.push({ from, to });
		from = to + 1;
	}
	return ranges;
}

function build(state: EditorState): DecorationSet {
	if (!state.field(editorLivePreviewField, false)) return Decoration.none;
	const builder = new RangeSetBuilder<Decoration>();
	for (const { from, to } of markerRanges(state.doc.toString(), state.selection.ranges)) builder.add(from, to, hidden);
	return builder.finish();
}

/** Hides the sync's page markers while editing in Live Preview. Reading view
 *  already hides them, since they are Obsidian comments; Source mode shows them. */
export function hideMarkers(): Extension {
	return StateField.define<DecorationSet>({
		create: build,
		update(value, tr) {
			const modeChanged = tr.startState.field(editorLivePreviewField, false) !== tr.state.field(editorLivePreviewField, false);
			return tr.docChanged || tr.selection || modeChanged ? build(tr.state) : value;
		},
		provide: (field) => EditorView.decorations.from(field),
	});
}
