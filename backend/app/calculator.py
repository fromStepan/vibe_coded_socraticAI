"""Exact arithmetic tool for the model. Parsed with ast over an allow-list — never eval()."""
import ast
import operator
from fractions import Fraction

CALCULATOR_TOOL = {
    "type": "function",
    "function": {
        "name": "calculate",
        "description": (
            "Evaluate an exact arithmetic expression and return the precise "
            "result (as a simplified fraction, with a mixed-number form if "
            "applicable). Supports +, -, *, /, //, %, ** (small integer powers), "
            "parentheses, decimals, and fractions written as a/b. Always use this "
            "instead of doing arithmetic mentally — it never rounds or makes carrying errors."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "expression": {
                    "type": "string",
                    "description": "e.g. '7 + 12' or '(9 + 10) / 12' — use the problem's own numbers, not an example",
                },
            },
            "required": ["expression"],
        },
    },
}

_BIN_OPS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.FloorDiv: operator.floordiv,
    ast.Mod: operator.mod,
    ast.Pow: operator.pow,
}
_UNARY_OPS = {ast.USub: operator.neg, ast.UAdd: operator.pos}


def _eval(node: ast.AST) -> Fraction:
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)) and not isinstance(node.value, bool):
        return Fraction(str(node.value))
    if isinstance(node, ast.BinOp) and type(node.op) in _BIN_OPS:
        left, right = _eval(node.left), _eval(node.right)
        if isinstance(node.op, (ast.Div, ast.FloorDiv, ast.Mod)) and right == 0:
            raise ValueError("division by zero")
        if isinstance(node.op, ast.Pow) and (right.denominator != 1 or abs(right) > 64):
            raise ValueError("only small integer powers are supported")
        return _BIN_OPS[type(node.op)](left, right)
    if isinstance(node, ast.UnaryOp) and type(node.op) in _UNARY_OPS:
        return _UNARY_OPS[type(node.op)](_eval(node.operand))
    raise ValueError(f"unsupported expression element: {type(node).__name__}")


def calculate(expression: str) -> str:
    """Never raises — the result feeds straight back into a tool-call message."""
    try:
        cleaned = expression.replace("×", "*").replace("÷", "/").replace(":", "/")
        result = Fraction(_eval(ast.parse(cleaned, mode="eval").body))
    except Exception as e:
        return f"Error: could not evaluate '{expression}' ({e})"

    if result.denominator == 1:
        return str(result.numerator)
    sign = "-" if result < 0 else ""
    whole, remainder = divmod(abs(result.numerator), result.denominator)
    text = str(result)
    if whole:
        text += f" (= {sign}{whole} {remainder}/{result.denominator})"
    return text
