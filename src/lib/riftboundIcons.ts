/**
 * Official Riftbound icon URLs from the Riot CDN.
 * SVG glyphs: assetcdn.rgpub.io/public/live/riot-shared/player-experiences/riot-glyphs/rb/latest/
 * PNG icons:  cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/
 */

const GLYPH_BASE = 'https://assetcdn.rgpub.io/public/live/riot-shared/player-experiences/riot-glyphs/rb/latest/';
const CMS_BASE = 'https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/';

/** Rune domain icons (64x64 PNG) used as large icons in card details */
export const RUNE_ICONS: Record<string, string> = {
  calm:    CMS_BASE + 'b9ef2f5b74841ad11f3629aa381a76ac0187d007-64x64.png?accountingTag=RB',
  fury:    CMS_BASE + '5aeb4bfd203b5d265902f65aa5afae7da1682eaa-64x64.png?accountingTag=RB',
  mind:    CMS_BASE + '17ab95a6bd052085b6803d846a287f625f347288-64x64.png?accountingTag=RB',
  body:    CMS_BASE + '7a5533034de5870808347bc4b296f0029bdd8eea-64x64.png?accountingTag=RB',
  chaos:   CMS_BASE + '597ddb82be59e87b467c52bb10204f02c2005d06-64x64.png?accountingTag=RB',
  order:   CMS_BASE + '8bb1b193a8e1adc26ca28e1a21da8d1e2f5d2f72-64x64.png?accountingTag=RB',
};

/** Inline glyph SVGs (for use in text formatting / card ability text) */
export const GLYPH_ICONS: Record<string, string> = {
  might:        GLYPH_BASE + 'might.svg',
  exhaust:      GLYPH_BASE + 'exhaust.svg',
  rune:         GLYPH_BASE + 'card_type_rune.svg',
  rune_calm:    GLYPH_BASE + 'rune_calm.svg',
  rune_fury:    GLYPH_BASE + 'rune_fury.svg',
  rune_mind:    GLYPH_BASE + 'rune_mind.svg',
  rune_body:    GLYPH_BASE + 'rune_body.svg',
  rune_chaos:   GLYPH_BASE + 'rune_chaos.svg',
  rune_order:   GLYPH_BASE + 'rune_order.svg',
  rune_rainbow: GLYPH_BASE + 'rune_rainbow.svg',
};

/** Card type icons (64x64 PNG) */
export const TYPE_ICONS: Record<string, string> = {
  unit:        CMS_BASE + 'cb0caf49361546ece0c25d65b7fbf57c0eee57f0-64x64.png?accountingTag=RB',
  champion:    CMS_BASE + 'c56f1df327f53562a56b493d3d38c3cee5780c5a-64x64.png?accountingTag=RB',
  spell:       CMS_BASE + '73c26354435212281d3f1cefe7cdbd7c803fe18f-64x64.png?accountingTag=RB',
  gear:        CMS_BASE + 'ee2664a6dfe767b7e8b4b08ed04611e019d2c166-64x64.png?accountingTag=RB',
  legend:      CMS_BASE + '59e98d14f83125c88880af1d61213e3aef941370-64x64.png?accountingTag=RB',
  battlefield: CMS_BASE + '1f37eb1bed2605bdaab8270a9dc4396cad746522-64x64.png?accountingTag=RB',
  rune:        CMS_BASE + 'fa3d8362379b722a5025995077a7fbd1b4a6ba0e-24x24.png?accountingTag=RB',
};

/** Rarity icons */
export const RARITY_ICONS: Record<string, string> = {
  common:   CMS_BASE + 'a088ae851d94b5c34aa4900e8ccb4cc103144dce-354x354.png?accountingTag=RB',
  uncommon: CMS_BASE + '808205a0f070e479107a7655e622fe15a356275b-480x410.png?accountingTag=RB',
  rare:     CMS_BASE + 'd90078e1ec2ef7cbcbba2be86da1b192c389581a-429x425.png?accountingTag=RB',
  epic:     CMS_BASE + '5e9799d87d0f8baa55f6d9bddb9750669a0f485b-455x419.png?accountingTag=RB',
  showcase: CMS_BASE + 'a0e92b9edf3291fa62c9b35ffd6363de0d7947c0-376x426.png?accountingTag=RB',
};

/** Domain/rune color accents */
export const DOMAIN_COLORS: Record<string, string> = {
  fury:  '#ef4444',
  calm:  '#22c55e',
  mind:  '#3b82f6',
  body:  '#f97316',
  chaos: '#a855f7',
  order: '#eab308',
};
