export interface ElementSignals {
  tag: string;
  /** Stable element id, empty when the element has no reusable id. */
  id: string;
  /** Nearest data-testid value, empty when none is present. */
  testId: string;
  /** Normalized visible text, value, placeholder, aria-label, or title. */
  text: string;
  /** Readable business classes, without library style classes. */
  classes: string[];
  /** Module classes from up to three ancestor elements. */
  areaClasses: string[];
  /** React component display names from the element outwards. */
  components: string[];
  /** Structural CSS path used only as a tie-breaker. */
  selector: string;
}

export interface ElementAnchor {
  /** Page coordinates captured when the comment was created. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CommentTarget extends ElementSignals {
  /** Human-readable element description, for example `<button> “提交”`. */
  description: string;
  anchor: ElementAnchor;
}

export interface PageComment {
  id: string;
  route: string;
  origin: string;
  viewport: string;
  target: CommentTarget;
  /** Nearest form item label at comment time. */
  formItem: string;
  /** Nearest section, card, or dialog title at comment time. */
  section: string;
  comment: string;
  createdAt: string;
}
