"""BlazePose (MediaPipe Pose) 33-landmark names, indices, and handedness mapping.

Shared across stages so joint references stay consistent.
"""
from __future__ import annotations

POSE_LANDMARKS = [
    "nose", "left_eye_inner", "left_eye", "left_eye_outer",
    "right_eye_inner", "right_eye", "right_eye_outer",
    "left_ear", "right_ear", "mouth_left", "mouth_right",
    "left_shoulder", "right_shoulder", "left_elbow", "right_elbow",
    "left_wrist", "right_wrist", "left_pinky", "right_pinky",
    "left_index", "right_index", "left_thumb", "right_thumb",
    "left_hip", "right_hip", "left_knee", "right_knee",
    "left_ankle", "right_ankle", "left_heel", "right_heel",
    "left_foot_index", "right_foot_index",
]
NAME_TO_IDX = {n: i for i, n in enumerate(POSE_LANDMARKS)}
N_LANDMARKS = len(POSE_LANDMARKS)

# Convenience indices
NOSE = 0
LEFT_SHOULDER, RIGHT_SHOULDER = 11, 12
LEFT_ELBOW, RIGHT_ELBOW = 13, 14
LEFT_WRIST, RIGHT_WRIST = 15, 16
LEFT_HIP, RIGHT_HIP = 23, 24


def sides(handedness: str) -> dict:
    """Map handedness to draw-side / bow-side landmark indices.

    A right-handed archer draws the string with the RIGHT hand and holds the
    bow in the LEFT hand (and vice versa for left-handed).
    """
    if handedness not in ("right", "left"):
        raise ValueError(f"handedness must be 'right' or 'left', got {handedness!r}")
    right = handedness == "right"
    draw = (RIGHT_WRIST, RIGHT_ELBOW, RIGHT_SHOULDER) if right else (LEFT_WRIST, LEFT_ELBOW, LEFT_SHOULDER)
    bow = (LEFT_WRIST, LEFT_ELBOW, LEFT_SHOULDER) if right else (RIGHT_WRIST, RIGHT_ELBOW, RIGHT_SHOULDER)
    return {
        "draw_wrist": draw[0], "draw_elbow": draw[1], "draw_shoulder": draw[2],
        "bow_wrist": bow[0], "bow_elbow": bow[1], "bow_shoulder": bow[2],
    }
