"""Burned caption fonts cover CJK + emoji without .notdef tofu."""
import pytest

from workers.tasks.video.render import _font_path_for_char, _path_has_glyph


@pytest.mark.parametrize("char", ["A", "日", "本", "न", "😀"])
def test_font_chain_covers_mixed_script_chars(char):
    path = _font_path_for_char(char)
    assert path
    assert _path_has_glyph(path, char), f"{path!r} missing glyph for {char!r}"


def test_mixed_sample_all_chars_have_glyph():
    sample = "Hello 日本語 नमस्ते 😀"
    for ch in sample:
        if ch.isspace():
            continue
        path = _font_path_for_char(ch)
        assert _path_has_glyph(path, ch), f"missing glyph for {ch!r} via {path!r}"
