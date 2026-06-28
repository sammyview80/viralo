from workers.tasks import video


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
