import type { ExtensionContext, ReaderDecoration, ReaderSelection, ViewHandle } from "../../sdk";
import { selectionPreview } from "../../sdk";
import { reactView } from "../../sdk/react";
import { selectRegion, selectRegionUnits, selectTextRegion } from "./select-region";
import type { SelectedRegion } from "./types";
import TranslationPopup from "./TranslationPopup";
import TranslationSettings from "./TranslationSettings";

import { locales } from "./locales";
const prefix = "cachalot.selection-translation";
export function activate(context: ExtensionContext) {
  context.localization.registerResources(locales);
  const Result = ({ data, close, signal }: ViewHandle) => (
    <TranslationPopup
      context={context}
      selection={data as SelectedRegion}
      signal={signal}
      onClose={close}
    />
  );
  const Settings = () => <TranslationSettings context={context} />;
  context.window.registerViewProvider(`${prefix}.result`, reactView(Result));
  context.window.registerViewProvider(`${prefix}.settings`, reactView(Settings));
  context.reader.registerInteractionTool({
    id: `${prefix}.region`,
    title: { zh: locales.zh.reader.region, en: locales.en.reader.region },
    tooltip: { zh: locales.zh.reader.regionTitle, en: locales.en.reader.regionTitle },
    icon: "▧",
    mode: "rectangle",
    preview(page, box): ReaderDecoration[] {
      return selectRegionUnits(page, box).map((unit) => ({
        ...unit,
        borderColor: "#8b5cf6",
        backgroundColor: "#8b5cf633",
      }));
    },
    select(page, gesture) {
      const selected = selectRegion(page, gesture.box);
      return selected.units.length ? { ...selectionPreview(gesture), ...selected } : null;
    },
  });
  context.commands.registerCommand(`${prefix}.translate`, async (...args) => {
    const selection = (args[0] || context.reader.selection) as ReaderSelection | null;
    if (!selection) return;
    let selected: SelectedRegion;
    if ("blockIds" in selection) selected = selection as SelectedRegion;
    else {
      const page = await context.documents.getSemanticPage(selection.documentId, selection.page);
      const box: [number, number, number, number] = [
        selection.x,
        selection.y,
        selection.x + selection.width,
        selection.y + selection.height,
      ];
      const result = selectTextRegion(
        page,
        box,
        selection.characterIndices ? new Set(selection.characterIndices) : undefined,
      );
      selected = {
        ...selection,
        ...result,
        text:
          result.formulas.length || result.blocks.some((block) => block.headingLevel)
            ? result.text
            : selection.text,
      };
    }
    if (context.reader.selection !== selection) return;
    context.window.showView(`${prefix}.result`, selected);
  });
  context.reader.registerSelectionAction({
    id: `${prefix}.translate`,
    title: { zh: locales.zh.reader.translate, en: locales.en.reader.translate },
    icon: { zh: locales.zh.reader.translateIcon, en: locales.en.reader.translateIcon },
    run: (selection) =>
      context.commands.executeCommand(`${prefix}.translate`, selection).then(() => undefined),
  });
}
