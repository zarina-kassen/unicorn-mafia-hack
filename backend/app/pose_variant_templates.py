"""Preset poses for fast first slots in the hybrid pose-variant pipeline.

Templates mix classic portrait and selfie posing ideas (45° angles, relaxed
hands, weight shifts, head angles) so random picks stay visually distinct.
"""

from __future__ import annotations

from .schemas import PoseTargetSpec

# Large pool; two are chosen at random per request for slots 0–1.
TEMPLATE_POSE_POOL: tuple[PoseTargetSpec, ...] = (
    PoseTargetSpec(
        title="45° slimming stance",
        instruction="Turn your torso about 45° from the camera; put most of your weight on the back foot.",
        rationale="Classic portrait angle: shorter camera-facing width, subtle curve through hips.",
        approximate_landmarks=[],
    ),
    PoseTargetSpec(
        title="Classic head tilt",
        instruction="Keep shoulders fairly square; tilt your head slightly to one shoulder.",
        rationale="Adds softness and dimension to the face without big body movement.",
        approximate_landmarks=[],
    ),
    PoseTargetSpec(
        title="Chin down, eyes up",
        instruction="Lower your chin a touch and look up toward the lens with relaxed eyes.",
        rationale="Flatters eyes and jawline; common editorial selfie angle.",
        approximate_landmarks=[],
    ),
    PoseTargetSpec(
        title="Hand on cheek, gap",
        instruction="Rest fingers lightly on your cheek or jaw; keep elbow away from your ribs.",
        rationale="Hand frames the face; space at the arm avoids a squeezed look.",
        approximate_landmarks=[],
    ),
    PoseTargetSpec(
        title="Over-the-shoulder glance",
        instruction="Angle your body away slightly, then turn your head to look back toward the camera.",
        rationale="Dynamic glance-back pose; works well in vertical selfie framing.",
        approximate_landmarks=[],
    ),
    PoseTargetSpec(
        title="Power stance",
        instruction="Stand tall, feet about hip-width; place one hand on your hip, shoulders relaxed.",
        rationale="Confident open shape; triangle with arm and waist reads strong on camera.",
        approximate_landmarks=[],
    ),
    PoseTargetSpec(
        title="Open body confidence",
        instruction="Face the camera a bit more squarely; let arms rest slightly away from your sides.",
        rationale="Takes up space in the frame; reads approachable and self-assured.",
        approximate_landmarks=[],
    ),
    PoseTargetSpec(
        title="Hip pop relaxed",
        instruction="Shift your hips slightly to one side; keep arms loose or one hand on a hip.",
        rationale="Adds curve and asymmetry without stiff posing.",
        approximate_landmarks=[],
    ),
    PoseTargetSpec(
        title="Forward foot energy",
        instruction="Place one foot a half-step closer to the camera; keep knees soft, torso tall.",
        rationale="Creates depth and a subtle walking-pause feel in still frames.",
        approximate_landmarks=[],
    ),
    PoseTargetSpec(
        title="Diamond legs",
        instruction="Stand with heels closer together and toes angled out into a soft V.",
        rationale="Fashion-style leg base; narrows the line at the ankles for full-body shots.",
        approximate_landmarks=[],
    ),
    PoseTargetSpec(
        title="Crossed-ankle stand",
        instruction="Cross one ankle lightly in front of the other; most weight on the back foot.",
        rationale="Relaxed standing pose; slim vertical line for portraits.",
        approximate_landmarks=[],
    ),
    PoseTargetSpec(
        title="Soft crossed arms",
        instruction="Cross your arms loosely below the chest; roll shoulders down and back.",
        rationale="Confident but not stiff; avoid pressing arms tight against the body.",
        approximate_landmarks=[],
    ),
    PoseTargetSpec(
        title="Thoughtful chin rest",
        instruction="Support your chin with knuckles or the side of a hand; elbow supported if seated.",
        rationale="Reader/editorial vibe; keep the hand light so the face does not squish.",
        approximate_landmarks=[],
    ),
    PoseTargetSpec(
        title="Look past the lens",
        instruction="Turn your gaze to a point beside the camera, not into the lens.",
        rationale="Candid story-telling look; reduces wide-eyed stare.",
        approximate_landmarks=[],
    ),
    PoseTargetSpec(
        title="Hair touch natural",
        instruction="Raise one hand to tuck hair behind your ear or brush the hairline lightly.",
        rationale="Gives the hands a job; feels in-motion and natural.",
        approximate_landmarks=[],
    ),
    PoseTargetSpec(
        title="Triangle frame hands",
        instruction="Bring both hands near your face with elbows wide, forming a loose triangle.",
        rationale="Draws attention to eyes; keep fingers relaxed, not rigid.",
        approximate_landmarks=[],
    ),
    PoseTargetSpec(
        title="Lean-in engagement",
        instruction="Shift your upper body slightly closer to the camera; keep neck long.",
        rationale="Feels intimate and friendly in close-up webcam framing.",
        approximate_landmarks=[],
    ),
    PoseTargetSpec(
        title="Desk lean casual",
        instruction="If seated, rest forearms on a surface in front of you; shoulders down.",
        rationale="Grounded creator or work-from-home vibe; stable for longer holds.",
        approximate_landmarks=[],
    ),
    PoseTargetSpec(
        title="Hands at low hips",
        instruction="Rest thumbs in pockets or hands on the front of your hips; elbows soft.",
        rationale="Casual full-body or three-quarter stance; avoids awkward dangling hands.",
        approximate_landmarks=[],
    ),
    PoseTargetSpec(
        title="Profile three-quarter",
        instruction="Turn until your nose lines up near your cheek on the far side—strong profile read.",
        rationale="Sculpts jaw and nose; strong for silhouette-style overlays.",
        approximate_landmarks=[],
    ),
    PoseTargetSpec(
        title="Gentle S-curve",
        instruction="Shift weight to one leg and let the opposite shoulder dip slightly forward.",
        rationale="Creates one continuous curve through shoulders and hips.",
        approximate_landmarks=[],
    ),
    PoseTargetSpec(
        title="Wrists loose, slight twist",
        instruction="Let wrists cross loosely low in front or at belt level; torso turned 20–30°.",
        rationale="Fashion-lite twist; different silhouette from classic crossed arms.",
        approximate_landmarks=[],
    ),
    PoseTargetSpec(
        title="Reach toward camera",
        instruction="Extend one hand partway toward the lens as if handing something; keep face sharp.",
        rationale="Adds depth and playful interaction; common short-video trope.",
        approximate_landmarks=[],
    ),
    PoseTargetSpec(
        title="Victory subtle",
        instruction="Raise one arm in a soft bent victory or wave; keep the other arm relaxed.",
        rationale="High energy without a full two-hand cheer; fits tight vertical crop.",
        approximate_landmarks=[],
    ),
    PoseTargetSpec(
        title="Cool neutral lean-back",
        instruction="Recline your shoulders slightly away from the camera; chin level, eyes relaxed.",
        rationale="Laid-back attitude read; pair with unhurried expression.",
        approximate_landmarks=[],
    ),
    PoseTargetSpec(
        title="Squint-smile ready",
        instruction="Relax your jaw; narrow your eyes just enough to look sun-lit or playful, not tense.",
        rationale="Model “squinch” lite for confident, camera-aware portraits.",
        approximate_landmarks=[],
    ),
)
