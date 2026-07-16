type JsonLike = null | boolean | number | string | JsonLike[] | { [key: string]: JsonLike | undefined };

function canonical(value: JsonLike): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key] as JsonLike)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export class IntentRegistry {
  private readonly intents = new Map<string, string>();

  constructor(private readonly createKey: () => string = () => crypto.randomUUID()) {}

  keyFor(resourceId: string, operation: string, body: JsonLike): string {
    const intent = this.intentId(resourceId, operation, body);
    const current = this.intents.get(intent);
    if (current) return current;
    const key = this.createKey();
    this.intents.set(intent, key);
    return key;
  }

  resolve(resourceId: string, operation: string, body: JsonLike): void {
    this.intents.delete(this.intentId(resourceId, operation, body));
  }

  private intentId(resourceId: string, operation: string, body: JsonLike): string {
    return `${resourceId}:${operation}:${canonical(body)}`;
  }
}
