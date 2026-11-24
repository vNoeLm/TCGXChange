export interface LocalizedLabel {
  en: string;
  hu: string;
}

export interface CardFieldSpec {
  label: LocalizedLabel;
  placeholder?: string;
}

export interface CardTextFieldSpec {
  key: 'ability' | 'effect' | 'text';
  label: LocalizedLabel;
  placeholder?: LocalizedLabel;
  preview?: boolean;
  italic?: boolean;
}

export interface GameCardEditorSchema {
  domain: CardFieldSpec | null;
  subtype: CardFieldSpec | null;
  /** Riftbound merges cost & energy into a single Energy field (syncing both DB columns). */
  syncEnergyToCost?: boolean;
  cost: CardFieldSpec | null;
  energy: CardFieldSpec | null;
  might: CardFieldSpec | null;
  mightBonus: CardFieldSpec | null;
  textFields: CardTextFieldSpec[];
  tagsLabel: LocalizedLabel;
}

export function getGameCardEditorSchema(game: string): GameCardEditorSchema {
  switch ((game || 'riftbound').toLowerCase()) {
    case 'onepiece':
      return {
        domain: { label: { en: 'Color(s)', hu: 'Szín(ek)' }, placeholder: 'Red, Green' },
        subtype: { label: { en: 'Traits / Type', hu: 'Frakció / Jellemzők' }, placeholder: 'Straw Hat Crew / Supernovas' },
        cost: { label: { en: 'Cost / Life', hu: 'Költség / Élet' }, placeholder: '4' },
        energy: null,
        might: { label: { en: 'Power', hu: 'Power' }, placeholder: '5000' },
        mightBonus: null,
        textFields: [
          {
            key: 'effect',
            label: { en: 'Effect', hu: 'Hatás' },
            placeholder: { en: '[On Play] Draw 1 card...', hu: '[On Play] Draw 1 card...' },
            preview: true,
          },
        ],
        tagsLabel: { en: 'Tags', hu: 'Tagek' },
      };

    case 'lorcana':
      return {
        domain: { label: { en: 'Ink', hu: 'Tinta' }, placeholder: 'Amber, Steel' },
        subtype: { label: { en: 'Classifications', hu: 'Besorolás' }, placeholder: 'Storyborn, Hero, Princess' },
        cost: { label: { en: 'Ink Cost', hu: 'Tintaköltség' }, placeholder: '3' },
        energy: { label: { en: 'Lore', hu: 'Lore' }, placeholder: '2' },
        might: { label: { en: 'Strength', hu: 'Erő' }, placeholder: '3' },
        mightBonus: { label: { en: 'Willpower', hu: 'Willpower' }, placeholder: '4' },
        textFields: [
          {
            key: 'text',
            label: { en: 'Ability', hu: 'Képesség' },
            placeholder: { en: 'Card ability text...', hu: 'Képesség szövege...' },
            preview: true,
          },
        ],
        tagsLabel: { en: 'Tags', hu: 'Tagek' },
      };

    case 'starwars':
      return {
        domain: { label: { en: 'Aspect(s)', hu: 'Aspektus' }, placeholder: 'Vigilance, Heroism' },
        subtype: { label: { en: 'Traits', hu: 'Jellemzők' }, placeholder: 'Imperial, Trooper' },
        cost: { label: { en: 'Cost', hu: 'Költség' }, placeholder: '3' },
        energy: null,
        might: { label: { en: 'Power', hu: 'Erő' }, placeholder: '3' },
        mightBonus: { label: { en: 'HP', hu: 'HP' }, placeholder: '4' },
        textFields: [
          {
            key: 'text',
            label: { en: 'Front Text', hu: 'Előlap szöveg' },
            placeholder: { en: 'Card text...', hu: 'Kártyaszöveg...' },
            preview: true,
          },
          {
            key: 'ability',
            label: { en: 'Back Text', hu: 'Hátlap szöveg' },
            placeholder: { en: 'Leader unit side (optional)...', hu: 'Hátlap szövege (opcionális)...' },
            preview: true,
          },
        ],
        tagsLabel: { en: 'Tags', hu: 'Tagek' },
      };

    case 'fab':
      return {
        domain: { label: { en: 'Class', hu: 'Osztály' }, placeholder: 'Ninja, Generic' },
        subtype: { label: { en: 'Type Line', hu: 'Típussor' }, placeholder: 'Ninja Action - Attack' },
        cost: { label: { en: 'Cost', hu: 'Költség' }, placeholder: '1' },
        energy: { label: { en: 'Pitch', hu: 'Pitch' }, placeholder: '1' },
        might: { label: { en: 'Attack', hu: 'Támadás' }, placeholder: '4' },
        mightBonus: { label: { en: 'Defense', hu: 'Védekezés' }, placeholder: '3' },
        textFields: [
          {
            key: 'text',
            label: { en: 'Card Text', hu: 'Képesség' },
            placeholder: { en: 'Card rules text...', hu: 'Képesség szövege...' },
            preview: true,
          },
        ],
        tagsLabel: { en: 'Tags', hu: 'Tagek' },
      };

    case 'mtg':
      return {
        domain: { label: { en: 'Color(s)', hu: 'Szín(ek)' }, placeholder: 'Blue, Red' },
        subtype: { label: { en: 'Subtype', hu: 'Altípus' }, placeholder: 'Human Wizard' },
        cost: { label: { en: 'Mana Value', hu: 'Mana érték' }, placeholder: '3' },
        energy: null,
        might: { label: { en: 'Power', hu: 'Power' }, placeholder: '2' },
        mightBonus: { label: { en: 'Toughness', hu: 'Toughness' }, placeholder: '3' },
        textFields: [
          {
            key: 'text',
            label: { en: 'Oracle Text', hu: 'Képesség' },
            placeholder: { en: 'Oracle rules text...', hu: 'Képesség szövege...' },
            preview: true,
          },
        ],
        tagsLabel: { en: 'Tags', hu: 'Tagek' },
      };

    default:
      // Riftbound
      return {
        domain: { label: { en: 'Domain', hu: 'Domén' }, placeholder: 'Fury, Chaos' },
        subtype: { label: { en: 'Supertype / Subtype', hu: 'Altípus' }, placeholder: 'Champion, Signature, Equipment' },
        syncEnergyToCost: true,
        cost: null,
        energy: { label: { en: 'Energy', hu: 'Energia' }, placeholder: '3' },
        might: { label: { en: 'Might', hu: 'Might' }, placeholder: '4' },
        mightBonus: { label: { en: 'Might Bonus', hu: 'Might bónusz' }, placeholder: '1' },
        textFields: [
          {
            key: 'ability',
            label: { en: 'Ability', hu: 'Képesség' },
            placeholder: { en: '[Action] ... <br /> ... :rb_might:', hu: '[Action] ... <br /> ... :rb_might:' },
            preview: true,
          },
          {
            key: 'text',
            label: { en: 'Flavor Text', hu: 'Hangulatszöveg' },
            placeholder: { en: 'Flavor quote...', hu: 'Hangulatszöveg...' },
            preview: false,
            italic: true,
          },
        ],
        tagsLabel: { en: 'Tags', hu: 'Tagek' },
      };
  }
}
