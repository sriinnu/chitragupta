/**
 * @chitragupta/vayu — Safe expression parser and path resolution.
 *
 * Recursive-descent expression evaluator inspired by Panini's Ashtadhyayi.
 * Supports literals, property access, arithmetic, comparison, logical, and
 * ternary operators. Rejects function calls, assignments, and code execution.
 * Extracted from executor-lifecycle.ts to keep file sizes under 450 LOC.
 */

/**
 * Resolve a dot-path on an object (simple JSONPath).
 */
export function resolvePath(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Safely evaluate a simple expression with a given scope.
 *
 * Inspired by Panini's Ashtadhyayi (~4th century BCE) — the first formal
 * grammar ever composed. Just as Panini decomposed Sanskrit into precise
 * production rules (sutras), this parser decomposes expressions via
 * recursive descent, each precedence level a sutra unto itself.
 *
 * Replaces the previous `new Function()` implementation which allowed
 * arbitrary code injection. This parser supports only a safe subset:
 * literals, property access, arithmetic, comparison, logical, and ternary
 * operators. Function calls, assignments, and all other code execution
 * forms are explicitly rejected.
 */
export function safeEval(expr: string, scope: Record<string, unknown>): unknown {
	// ── Lexer ──────────────────────────────────────────────────────────
	const enum Tk {
		Num, Str, Bool, Null, Undef, Ident,
		Plus, Minus, Star, Slash, Percent,
		Lt, Gt, LtEq, GtEq, EqEq, NotEq, EqEqEq, NotEqEq,
		And, Or, Bang,
		Question, Colon, Dot,
		LParen, RParen, LBrack, RBrack,
		Comma, Eof,
	}

	interface Token {
		type: Tk;
		value: string;
		start: number;
	}

	function tokenize(src: string): Token[] {
		const tokens: Token[] = [];
		let i = 0;

		while (i < src.length) {
			// Skip whitespace
			if (/\s/.test(src[i])) { i++; continue; }

			const start = i;

			// Numbers (integer and float, no leading dot)
			if (/[0-9]/.test(src[i]) || (src[i] === "." && i + 1 < src.length && /[0-9]/.test(src[i + 1]))) {
				while (i < src.length && /[0-9]/.test(src[i])) i++;
				if (i < src.length && src[i] === ".") {
					i++;
					while (i < src.length && /[0-9]/.test(src[i])) i++;
				}
				tokens.push({ type: Tk.Num, value: src.slice(start, i), start });
				continue;
			}

			// Strings
			if (src[i] === '"' || src[i] === "'") {
				const quote = src[i];
				i++;
				let s = "";
				while (i < src.length && src[i] !== quote) {
					if (src[i] === "\\") {
						i++;
						if (i >= src.length) break;
						const esc: Record<string, string> = { n: "\n", t: "\t", r: "\r", "\\": "\\", "'": "'", '"': '"' };
						s += esc[src[i]] ?? src[i];
					} else {
						s += src[i];
					}
					i++;
				}
				if (i < src.length) i++; // closing quote
				tokens.push({ type: Tk.Str, value: s, start });
				continue;
			}

			// Template literals — disallowed
			if (src[i] === "`") {
				throw new Error("Template literals are not allowed in expressions");
			}

			// Identifiers and keywords
			if (/[a-zA-Z_$]/.test(src[i])) {
				while (i < src.length && /[a-zA-Z0-9_$]/.test(src[i])) i++;
				const word = src.slice(start, i);

				// Disallowed keywords
				const forbidden = ["new", "delete", "typeof", "instanceof", "in", "void", "throw", "yield", "await", "class", "function", "var", "let", "const", "import", "export", "this"];
				if (forbidden.includes(word)) {
					throw new Error(`Keyword "${word}" is not allowed in expressions`);
				}

				if (word === "true" || word === "false") {
					tokens.push({ type: Tk.Bool, value: word, start });
				} else if (word === "null") {
					tokens.push({ type: Tk.Null, value: word, start });
				} else if (word === "undefined") {
					tokens.push({ type: Tk.Undef, value: word, start });
				} else {
					tokens.push({ type: Tk.Ident, value: word, start });
				}
				continue;
			}

			// Multi-character operators
			const two = src.slice(i, i + 3);
			if (two === "===" || two === "!==") {
				tokens.push({ type: two === "===" ? Tk.EqEqEq : Tk.NotEqEq, value: two, start });
				i += 3;
				continue;
			}

			const pair = src.slice(i, i + 2);
			if (pair === "==" || pair === "!=" || pair === "<=" || pair === ">=" || pair === "&&" || pair === "||") {
				const tkType: Record<string, Tk> = {
					"==": Tk.EqEq, "!=": Tk.NotEq,
					"<=": Tk.LtEq, ">=": Tk.GtEq,
					"&&": Tk.And, "||": Tk.Or,
				};
				tokens.push({ type: tkType[pair], value: pair, start });
				i += 2;
				continue;
			}

			// Reject assignment operators
			if (src[i] === "=" && i + 1 < src.length && src[i + 1] !== "=") {
				throw new Error("Assignment is not allowed in expressions");
			}

			// Single-character tokens
			const singles: Record<string, Tk> = {
				"+": Tk.Plus, "-": Tk.Minus, "*": Tk.Star, "/": Tk.Slash, "%": Tk.Percent,
				"<": Tk.Lt, ">": Tk.Gt, "!": Tk.Bang,
				"?": Tk.Question, ":": Tk.Colon, ".": Tk.Dot,
				"(": Tk.LParen, ")": Tk.RParen,
				"[": Tk.LBrack, "]": Tk.RBrack,
				",": Tk.Comma,
			};

			if (singles[src[i]] !== undefined) {
				tokens.push({ type: singles[src[i]], value: src[i], start });
				i++;
				continue;
			}

			// Reject regex literals (starting with /)
			if (src[i] === "/") {
				throw new Error("Regular expressions are not allowed in expressions");
			}

			throw new Error(`Unexpected character '${src[i]}' at position ${i}`);
		}

		tokens.push({ type: Tk.Eof, value: "", start: i });
		return tokens;
	}

	// ── Parser (recursive descent, Panini-style sutras) ────────────────
	let tokens: Token[];
	let pos: number;

	function peek(): Token { return tokens[pos]; }
	function advance(): Token { return tokens[pos++]; }
	function expect(type: Tk): Token {
		const t = advance();
		if (t.type !== type) {
			throw new Error(`Expected token type ${type}, got ${t.type} ("${t.value}") at position ${t.start}`);
		}
		return t;
	}
	function match(type: Tk): boolean {
		if (peek().type === type) { advance(); return true; }
		return false;
	}

	// Sutra 1: Ternary (lowest precedence)
	function parseTernary(): unknown {
		const cond = parseOr();
		if (match(Tk.Question)) {
			const consequent = parseTernary();
			expect(Tk.Colon);
			const alternate = parseTernary();
			return cond ? consequent : alternate;
		}
		return cond;
	}

	// Sutra 2: Logical OR
	function parseOr(): unknown {
		let left = parseAnd();
		while (peek().type === Tk.Or) {
			advance();
			const right = parseAnd();
			left = left || right;
		}
		return left;
	}

	// Sutra 3: Logical AND
	function parseAnd(): unknown {
		let left = parseEquality();
		while (peek().type === Tk.And) {
			advance();
			const right = parseEquality();
			left = left && right;
		}
		return left;
	}

	// Sutra 4: Equality (===, !==, ==, !=)
	function parseEquality(): unknown {
		let left = parseComparison();
		while (true) {
			const t = peek().type;
			if (t === Tk.EqEqEq) { advance(); left = left === parseComparison(); }
			else if (t === Tk.NotEqEq) { advance(); left = left !== parseComparison(); }
			else if (t === Tk.EqEq) { advance(); left = left == parseComparison(); }
			else if (t === Tk.NotEq) { advance(); left = left != parseComparison(); }
			else break;
		}
		return left;
	}

	// Sutra 5: Comparison (<, >, <=, >=)
	function parseComparison(): unknown {
		let left = parseAdditive();
		while (true) {
			const t = peek().type;
			if (t === Tk.Lt) { advance(); left = (left as number) < (parseAdditive() as number); }
			else if (t === Tk.Gt) { advance(); left = (left as number) > (parseAdditive() as number); }
			else if (t === Tk.LtEq) { advance(); left = (left as number) <= (parseAdditive() as number); }
			else if (t === Tk.GtEq) { advance(); left = (left as number) >= (parseAdditive() as number); }
			else break;
		}
		return left;
	}

	// Sutra 6: Addition / Subtraction
	function parseAdditive(): unknown {
		let left = parseMultiplicative();
		while (true) {
			const t = peek().type;
			if (t === Tk.Plus) { advance(); left = (left as number) + (parseMultiplicative() as number); }
			else if (t === Tk.Minus) { advance(); left = (left as number) - (parseMultiplicative() as number); }
			else break;
		}
		return left;
	}

	// Sutra 7: Multiplication / Division / Modulo
	function parseMultiplicative(): unknown {
		let left = parseUnary();
		while (true) {
			const t = peek().type;
			if (t === Tk.Star) { advance(); left = (left as number) * (parseUnary() as number); }
			else if (t === Tk.Slash) { advance(); left = (left as number) / (parseUnary() as number); }
			else if (t === Tk.Percent) { advance(); left = (left as number) % (parseUnary() as number); }
			else break;
		}
		return left;
	}

	// Sutra 8: Unary (!, -, +)
	function parseUnary(): unknown {
		if (peek().type === Tk.Bang) { advance(); return !parseUnary(); }
		if (peek().type === Tk.Minus) { advance(); return -(parseUnary() as number); }
		if (peek().type === Tk.Plus) { advance(); return +(parseUnary() as number); }
		return parsePostfix();
	}

	// Sutra 9: Property access (a.b, a[expr]) — rejects function calls
	function parsePostfix(): unknown {
		let obj = parsePrimary();
		while (true) {
			if (peek().type === Tk.Dot) {
				advance();
				const prop = expect(Tk.Ident);
				// Reject method calls: a.b()
				if (peek().type === Tk.LParen) {
					throw new Error("Function calls are not allowed in expressions");
				}
				if (obj == null) return undefined;
				obj = (obj as Record<string, unknown>)[prop.value];
			} else if (peek().type === Tk.LBrack) {
				advance();
				const key = parseTernary();
				expect(Tk.RBrack);
				// Reject method calls: a[key]()
				if (peek().type === Tk.LParen) {
					throw new Error("Function calls are not allowed in expressions");
				}
				if (obj == null) return undefined;
				obj = (obj as Record<string, unknown>)[key as string | number];
			} else if (peek().type === Tk.LParen) {
				// Direct function call: foo()
				throw new Error("Function calls are not allowed in expressions");
			} else {
				break;
			}
		}
		return obj;
	}

	// Sutra 10: Primary expressions (literals, identifiers, grouping)
	function parsePrimary(): unknown {
		const t = peek();

		switch (t.type) {
			case Tk.Num:
				advance();
				return Number(t.value);

			case Tk.Str:
				advance();
				return t.value;

			case Tk.Bool:
				advance();
				return t.value === "true";

			case Tk.Null:
				advance();
				return null;

			case Tk.Undef:
				advance();
				return undefined;

			case Tk.Ident: {
				advance();
				const name = t.value;
				if (!(name in scope)) return undefined;
				return scope[name];
			}

			case Tk.LParen: {
				advance();
				const inner = parseTernary();
				expect(Tk.RParen);
				return inner;
			}

			default:
				throw new Error(`Unexpected token "${t.value}" at position ${t.start}`);
		}
	}

	// ── Execute ────────────────────────────────────────────────────────
	try {
		tokens = tokenize(expr);
		pos = 0;

		// Handle empty expression
		if (tokens.length === 1 && tokens[0].type === Tk.Eof) {
			return undefined;
		}

		const result = parseTernary();

		// Ensure we consumed the entire expression
		if (peek().type !== Tk.Eof) {
			throw new Error(`Unexpected token "${peek().value}" at position ${peek().start}`);
		}

		return result;
	} catch {
		return undefined;
	}
}
