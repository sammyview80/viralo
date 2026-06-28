from workers.tasks import video


def test_voiceover_script_captions_span_voice_duration():
    captions = video._voiceover_script_to_captions(
        "This cold case was solved by pure accident",
        voice_duration_sec=4.0,
        clip_duration_sec=8.0,
        max_words=3,
    )

    assert captions[0].start == 0
    assert captions[-1].end <= 4.0
    assert "This cold case" == captions[0].text
    assert captions[0].words[0].word == "This"
    assert captions[0].words[0].start == 0
    assert captions[-1].words[-1].end == captions[-1].end


def test_voiceover_script_captions_use_same_timeline_for_visual_styles():
    captions = video._voiceover_script_to_captions(
        "Here is your synced subtitle",
        voice_duration_sec=2.0,
        clip_duration_sec=5.0,
        max_words=4,
    )

    capcut_timeline = video._build_caption_timeline(captions, "capcut")
    classic_timeline = video._build_caption_timeline(captions, "classic")

    assert capcut_timeline[0][0] == ["Here", "is", "your", "synced"]
    assert classic_timeline[0] == ("Here is your synced", None)
    assert 180 in capcut_timeline
    assert 180 in classic_timeline
