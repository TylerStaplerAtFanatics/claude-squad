import {
  hint,
  keys,
  key,
  separator,
  description,
  hintsContainer,
  title,
  hints,
} from "./KeyboardHint.css";

interface KeyboardHintProps {
  keys: string | string[];
  description: string;
  className?: string;
}

export function KeyboardHint({ keys, description, className = "" }: KeyboardHintProps) {
  const keyArray = Array.isArray(keys) ? keys : [keys];

  return (
    <div className={`${hint} ${className}`}>
      <div className={keys}>
        {keyArray.map((key, index) => (
          <span key={index}>
            <kbd className={key}>{key}</kbd>
            {index < keyArray.length - 1 && (
              <span className={separator}>+</span>
            )}
          </span>
        ))}
      </div>
      <span className={description}>{description}</span>
    </div>
  );
}

interface KeyboardHintsProps {
  hints: Array<{
    keys: string | string[];
    description: string;
  }>;
  title?: string;
  className?: string;
}

export function KeyboardHints({ hints, title, className = "" }: KeyboardHintsProps) {
  return (
    <div className={`${hintsContainer} ${className}`}>
      {title && <h3 className={title}>{title}</h3>}
      <div className={hints}>
        {hints.map((hint, index) => (
          <KeyboardHint
            key={index}
            keys={hint.keys}
            description={hint.description}
          />
        ))}
      </div>
    </div>
  );
}
