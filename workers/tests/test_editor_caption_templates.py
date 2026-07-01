from workers.tasks import video


def test_editor_timeline_shifts_captions_and_markers_to_trimmed_render():
    captions = [
        {"text": "before", "start_sec": 1.0, "end_sec": 2.0},
        {"text": "overlap", "start_sec": 4.5, "end_sec": 6.0},
        {"text": "inside", "start_sec": 7.0, "end_sec": 8.0},
        {"text": "after", "start_sec": 12.0, "end_sec": 13.0},
    ]
    markers = [
        {"id": "before", "time_ms": 4000, "sound": "pop"},
        {"id": "inside", "time_ms": 7500, "sound": "pop"},
        {"id": "after", "time_ms": 13000, "sound": "pop"},
    ]

    shifted_captions, shifted_markers = video._normalize_editor_timeline(
        captions,
        markers,
        trim_start_sec=5.0,
        trim_end_sec=10.0,
    )

    assert [c["text"] for c in shifted_captions] == ["overlap", "inside"]
    assert shifted_captions[0]["start_sec"] == 0.0
    assert shifted_captions[0]["end_sec"] == 1.0
    assert shifted_captions[1]["start_sec"] == 2.0
    assert shifted_captions[1]["end_sec"] == 3.0
    assert [m["id"] for m in shifted_markers] == ["inside"]
    assert shifted_markers[0]["time_ms"] == 2500


def test_editor_caption_filter_supports_reference_templates():
    captions = [
        {
            "text": "Here is your subtitle",
            "start_sec": 1.0,
            "end_sec": 3.0,
            "position": "bottom",
            "color": "#ffffff",
            "font_size": 32,
            "template": "mr-beast",
        },
        {
            "text": "Business subtitle",
            "start_sec": 4.0,
            "end_sec": 6.0,
            "position": "bottom",
            "color": "#ffffff",
            "font_size": 28,
            "template": "business",
        },
    ]

    filt = video._build_caption_filter(captions)

    assert "box=1" in filt
    assert "boxcolor=0xffd21f" in filt
    assert "fontcolor=0x00a7b7" in filt
    assert "shadowcolor=0x000000" in filt
    assert "between(t,1.0,3.0)" in filt
    assert "between(t,4.0,6.0)" in filt


def test_editor_caption_filter_supports_extended_templates():
    captions = [
        {
            "text": "neon line",
            "start_sec": 0.0,
            "end_sec": 1.0,
            "position": "bottom",
            "color": "#ffffff",
            "font_size": 28,
            "template": "neon",
        },
        {
            "text": "karaoke line",
            "start_sec": 1.0,
            "end_sec": 2.0,
            "position": "center",
            "color": "#ffffff",
            "font_size": 28,
            "template": "karaoke",
        },
        {
            "text": "news line",
            "start_sec": 2.0,
            "end_sec": 3.0,
            "position": "top",
            "color": "#ffffff",
            "font_size": 28,
            "template": "news",
        },
    ]

    filt = video._build_caption_filter(captions)

    assert "fontcolor=0x39ff14" in filt
    assert "boxcolor=0x101026@0.84" in filt
    assert "fontcolor=0xfff2a8" in filt
    assert "boxcolor=0xe11d48@0.92" in filt
    assert "text='NEWS LINE'" in filt
    assert "y=h*0.10" in filt


def test_editor_caption_filter_defaults_old_captions():
    filt = video._build_caption_filter([
        {
            "text": "Old caption",
            "start_sec": 0.0,
            "end_sec": 2.0,
            "position": "center",
            "color": "#ffee00",
            "font_size": 24,
        }
    ])

    assert "fontcolor=0xffee00" in filt
    assert "y=h*0.50" in filt
