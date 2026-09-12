"""
Generates realistic-looking Workout Tracker seed data for testing the app
via Dev Tools > Import (per store). Not part of the app itself -- run this
once to (re)produce the JSON files in this folder.

Usage:
    python generate.py

Produces (in this folder), each shaped like the app's own Export output
({ store, exportedAt, schemaVersion, records }) so Dev Tools' importer
accepts them directly:
    exercises.json        20 exercises across every metric type/unit combo,
                           some with a global note (Exercise.notes)
    gyms.json              3 custom gyms (General already exists in the app)
    workouts.json          32 finished workouts (4/week for 8 weeks)
    sets.json               every logged set across all 32 workouts
    personalRecords.json    full PR history per exercise+gym pair -- a new
                             entry each time the top set actually improved
    exerciseNotes.json      a handful of one-off per-workout notes
"""

import json
import random
from datetime import date, timedelta

random.seed(42)
SCHEMA_VERSION = 1


def export_payload(store, records):
    return {
        "store": store,
        "exportedAt": "2026-09-12T12:00:00.000Z",
        "schemaVersion": SCHEMA_VERSION,
        "records": records,
    }


# -- Gyms -------------------------------------------------------------------

GYM_POWERHOUSE = "gym-powerhouse"
GYM_HOME = "gym-home"
GYM_ANYTIME = "gym-anytime"
GENERAL = "general"

gyms = [
    {"id": GYM_POWERHOUSE, "name": "PowerHouse Fitness", "schemaVersion": SCHEMA_VERSION},
    {"id": GYM_HOME, "name": "Home Gym", "schemaVersion": SCHEMA_VERSION},
    {"id": GYM_ANYTIME, "name": "Anytime Fitness", "schemaVersion": SCHEMA_VERSION},
]


# -- Exercises ----------------------------------------------------------------
# Each entry: id, name, muscleGroups, metric(type,unit), effortTracking,
# and a small "profile" describing how it's logged (used by the set
# generator below): kind = 'compound' | 'isolation' | 'bodyweight' |
# 'per_side' | 'duration' | 'distance'; base/inc drive the 8-week
# progression; sets/reps describe typical volume.

EXERCISES = [
    dict(id="ex-bench-press", name="Bench Press", muscleGroups=["chest", "tricep", "shoulders"],
         metric=("reps", "kg"), effort="rir", kind="compound", warmup=(10, 40), base=60, inc=1.5, reps=(8, 6), sets=3),
    dict(id="ex-incline-db-press", name="Incline Dumbbell Press", muscleGroups=["chest", "shoulders"],
         metric=("reps", "kg_per_side"), effort="rpe", kind="isolation", base=22, inc=0.5, reps=(10, 8), sets=3),
    dict(id="ex-overhead-press", name="Overhead Press", muscleGroups=["shoulders", "tricep"],
         metric=("reps", "kg"), effort="rir", kind="compound", warmup=(10, 20), base=35, inc=0.75, reps=(8, 6), sets=3),
    dict(id="ex-pushup", name="Push-up", muscleGroups=["chest", "tricep"],
         metric=("reps", "none"), effort="rir", kind="bodyweight", base=15, inc=1.0, reps=(15, 12), sets=3),
    dict(id="ex-tricep-pushdown", name="Tricep Pushdown", muscleGroups=["tricep"],
         metric=("reps", "kg"), effort="rir", kind="isolation", base=25, inc=0.75, reps=(12, 10), sets=3),
    dict(id="ex-lateral-raise", name="Lateral Raise", muscleGroups=["shoulders"],
         metric=("reps", "kg_per_side"), effort="rir", kind="isolation", base=8, inc=0.3, reps=(15, 12), sets=3),

    dict(id="ex-deadlift", name="Deadlift", muscleGroups=["lower_back", "hamstring", "glutes"],
         metric=("reps", "kg"), effort="rir", kind="compound", warmup=(8, 60), base=100, inc=2.5, reps=(5, 5), sets=3),
    dict(id="ex-barbell-row", name="Barbell Row", muscleGroups=["teres", "lats"],
         metric=("reps", "kg"), effort="rir", kind="compound", warmup=(10, 30), base=55, inc=1.0, reps=(10, 8), sets=3),
    dict(id="ex-pullup", name="Pull-up", muscleGroups=["lats", "teres", "bicep"],
         metric=("reps", "none"), effort="rir", kind="bodyweight", base=6, inc=0.6, reps=(6, 6), sets=3),
    dict(id="ex-lat-pulldown", name="Lat Pulldown", muscleGroups=["lats", "teres"],
         metric=("reps", "kg"), effort="rir", kind="isolation", base=50, inc=1.0, reps=(10, 8), sets=3),
    dict(id="ex-seated-cable-row", name="Seated Cable Row", muscleGroups=["teres", "lats"],
         metric=("reps", "kg"), effort="rpe", kind="isolation", base=55, inc=1.0, reps=(10, 8), sets=3),
    dict(id="ex-bicep-curl", name="Bicep Curl", muscleGroups=["bicep"],
         metric=("reps", "kg_per_side"), effort="rir", kind="isolation", base=12, inc=0.4, reps=(12, 10), sets=3),
    dict(id="ex-hammer-curl", name="Hammer Curl", muscleGroups=["bicep", "forearm"],
         metric=("reps", "kg_per_side"), effort="rir", kind="isolation", base=10, inc=0.4, reps=(12, 10), sets=3),

    dict(id="ex-squat", name="Squat", muscleGroups=["quads", "glutes"],
         metric=("reps", "kg"), effort="rpe", kind="compound", warmup=(10, 40), base=80, inc=2.0, reps=(8, 6), sets=3),
    dict(id="ex-rdl", name="Romanian Deadlift", muscleGroups=["hamstring", "glutes"],
         metric=("reps", "kg"), effort="rir", kind="isolation", base=70, inc=1.5, reps=(10, 8), sets=3),
    dict(id="ex-leg-press", name="Leg Press", muscleGroups=["quads", "glutes"],
         metric=("reps", "kg"), effort="rpe", kind="isolation", base=120, inc=3.0, reps=(12, 10), sets=3),
    dict(id="ex-walking-lunge", name="Walking Lunge", muscleGroups=["quads", "glutes"],
         metric=("reps_per_side", "kg_per_side"), effort="rir", kind="per_side", base=12, inc=0.4, reps=(11, 10), sets=3),
    dict(id="ex-calf-raise", name="Calf Raise", muscleGroups=["calves"],
         metric=("reps", "kg"), effort="none", kind="isolation", base=60, inc=1.75, reps=(15, 12), sets=3),

    dict(id="ex-plank", name="Plank", muscleGroups=["abs_core"],
         metric=("seconds", "none"), effort="none", kind="duration", base=60, inc=5.0, sets=2),
    dict(id="ex-treadmill-run", name="Treadmill Run", muscleGroups=["cardio"],
         metric=("meters", "none"), effort="none", kind="distance", base=3000, inc=185.0, sets=1),
]

# Global, permanent notes on the exercise itself (Exercise.notes) -- shown
# every time regardless of workout, unlike the per-workout notes below.
# Only some exercises get one, same as a real user would only bother for a
# handful of movements that need a standing reminder.
GLOBAL_NOTES = {
    "ex-bench-press": "Keep shoulder blades pinned back. Grip slightly narrower than last cycle.",
    "ex-overhead-press": "Warm up shoulders thoroughly -- old impingement flares up if rushed.",
    "ex-deadlift": "Mixed grip on top set only. Reset breath/brace between every rep.",
    "ex-pullup": "Full dead hang at the bottom, no kipping.",
    "ex-squat": "Low-bar position. Knees out, chase depth before adding weight.",
    "ex-walking-lunge": "Use the 12kg dumbbells max in the home gym -- ceiling height limits anything heavier overhead-adjacent.",
    "ex-rdl": "Soft knees, push hips back, stop at mid-shin. Don't round the lower back.",
    "ex-plank": "Squeeze glutes, neutral neck. Quality over duration.",
}

exercises = []
for ex in EXERCISES:
    exercises.append({
        "id": ex["id"],
        "name": ex["name"],
        "muscleGroups": ex["muscleGroups"],
        "metric": {"type": ex["metric"][0], "unit": ex["metric"][1]},
        "effortTracking": ex["effort"],
        "notes": GLOBAL_NOTES.get(ex["id"], ""),
        "schemaVersion": SCHEMA_VERSION,
    })

BY_ID = {ex["id"]: ex for ex in EXERCISES}

PUSH_DAY = ["ex-bench-press", "ex-incline-db-press", "ex-overhead-press", "ex-pushup",
            "ex-tricep-pushdown", "ex-lateral-raise"]
PULL_DAY = ["ex-deadlift", "ex-barbell-row", "ex-pullup", "ex-lat-pulldown",
            "ex-seated-cable-row", "ex-bicep-curl", "ex-hammer-curl"]
LEGS_DAY = ["ex-squat", "ex-rdl", "ex-leg-press", "ex-walking-lunge", "ex-calf-raise"]
CARDIO_DAY = ["ex-plank", "ex-treadmill-run"]

DAY_TYPES = [
    ("Push Day", PUSH_DAY),
    ("Pull Day", PULL_DAY),
    ("Leg Day", LEGS_DAY),
    ("Cardio & Core", CARDIO_DAY),
]

# 8 weeks -> which gym the weighted (Push/Pull/Legs) days use that week.
# Cardio/core exercises always log at General (equipment-independent).
WEEK_GYM = [GYM_POWERHOUSE, GYM_POWERHOUSE, GYM_POWERHOUSE,
            GYM_HOME, GYM_HOME,
            GYM_ANYTIME, GYM_ANYTIME, GYM_ANYTIME]

START = date(2026, 7, 13)  # 8 weeks before the ~Sept 12 "today" used elsewhere this session
DAY_OFFSETS = [0, 2, 4, 5]  # Mon / Wed / Fri / Sat each week


def fmt_kg(value):
    """Round to the nearest 2.5 (plates) or 0.5 (dumbbells) depending on
    magnitude, formatted the way a user would actually type it."""
    step = 0.5 if value < 20 else 2.5
    rounded = round(value / step) * step
    if rounded == int(rounded):
        return str(int(rounded))
    return f"{rounded:.1f}"


def rir_for(set_index, total_sets):
    """Later sets are logged closer to failure, with a little noise."""
    base = max(0, 3 - set_index) + random.choice([0, 0, 1])
    return "6+" if base >= 6 else str(min(base, 5))


def rpe_for(set_index, total_sets):
    """Opposite direction from RIR: later sets are logged as *higher*
    effort, climbing toward (but rarely hitting) a true 10."""
    base = 6 + set_index + random.choice([0, 0, 1])
    return str(min(base, 9))


workouts = []
sets = []
set_counter = 0


def next_set_id():
    global set_counter
    set_counter += 1
    return f"set-{set_counter:04d}"


for week in range(8):
    gym_for_week = WEEK_GYM[week]
    for day_index, (day_name, exercise_ids) in enumerate(DAY_TYPES):
        workout_date = START + timedelta(days=week * 7 + DAY_OFFSETS[day_index])
        workout_id = f"wk-{week:02d}-{day_index}"
        workouts.append({
            "id": workout_id,
            "name": day_name,
            "date": workout_date.isoformat(),
            "exerciseOrder": exercise_ids,
            "schemaVersion": SCHEMA_VERSION,
        })

        for exercise_id in exercise_ids:
            ex = BY_ID[exercise_id]
            gym_id = GENERAL if ex["kind"] in ("duration", "distance") else gym_for_week
            progression = week + random.uniform(-0.3, 0.5)  # slight week-to-week noise

            # -- warm-up set (compounds only) --------------------------------
            if "warmup" in ex:
                w_reps, w_weight = ex["warmup"]
                sets.append({
                    "set_id": next_set_id(),
                    "exercise_id": exercise_id,
                    "workout_id": workout_id,
                    "set_number": 1,
                    "is_warmup_set": True,
                    "input_1": str(w_reps),
                    "input_1_right": None,
                    "input_2": fmt_kg(w_weight),
                    "rir": None,
                    "rpe": None,
                    "notes": "",
                    "gym_id": gym_id,
                    "schemaVersion": SCHEMA_VERSION,
                })

            total_sets = ex["sets"]
            for i in range(total_sets):
                set_number = i + 1

                if ex["kind"] in ("compound", "isolation"):
                    weight = ex["base"] + ex["inc"] * progression - i * (ex["inc"] * 0.6)
                    hi, lo = ex["reps"]
                    reps = max(lo, hi - i)
                    sets.append({
                        "set_id": next_set_id(), "exercise_id": exercise_id, "workout_id": workout_id,
                        "set_number": set_number, "is_warmup_set": False,
                        "input_1": str(reps), "input_1_right": None, "input_2": fmt_kg(weight),
                        "rir": rir_for(i, total_sets) if ex["effort"] == "rir" else None,
                        "rpe": rpe_for(i, total_sets) if ex["effort"] == "rpe" else None,
                        "notes": "", "gym_id": gym_id, "schemaVersion": SCHEMA_VERSION,
                    })

                elif ex["kind"] == "bodyweight":
                    hi, lo = ex["reps"]
                    reps = max(lo - 1, round(hi + ex["inc"] * progression) - i)
                    sets.append({
                        "set_id": next_set_id(), "exercise_id": exercise_id, "workout_id": workout_id,
                        "set_number": set_number, "is_warmup_set": False,
                        "input_1": str(max(1, reps)), "input_1_right": None, "input_2": None,
                        "rir": rir_for(i, total_sets) if ex["effort"] == "rir" else None,
                        "rpe": rpe_for(i, total_sets) if ex["effort"] == "rpe" else None,
                        "notes": "", "gym_id": gym_id, "schemaVersion": SCHEMA_VERSION,
                    })

                elif ex["kind"] == "per_side":
                    weight = ex["base"] + ex["inc"] * progression - i * (ex["inc"] * 0.5)
                    hi, lo = ex["reps"]
                    reps_l = max(lo, hi - i)
                    reps_r = reps_l - random.choice([0, 0, 1])  # slight natural L/R asymmetry
                    sets.append({
                        "set_id": next_set_id(), "exercise_id": exercise_id, "workout_id": workout_id,
                        "set_number": set_number, "is_warmup_set": False,
                        "input_1": str(reps_l), "input_1_right": str(reps_r), "input_2": fmt_kg(weight),
                        "rir": rir_for(i, total_sets) if ex["effort"] == "rir" else None,
                        "rpe": rpe_for(i, total_sets) if ex["effort"] == "rpe" else None,
                        "notes": "", "gym_id": gym_id, "schemaVersion": SCHEMA_VERSION,
                    })

                elif ex["kind"] == "duration":
                    seconds = round(ex["base"] + ex["inc"] * progression + i * 5)
                    sets.append({
                        "set_id": next_set_id(), "exercise_id": exercise_id, "workout_id": workout_id,
                        "set_number": set_number, "is_warmup_set": False,
                        "input_1": str(seconds), "input_1_right": None, "input_2": None,
                        "rir": None, "rpe": None, "notes": "", "gym_id": gym_id, "schemaVersion": SCHEMA_VERSION,
                    })

                elif ex["kind"] == "distance":
                    meters = round(ex["base"] + ex["inc"] * progression * 4, -1)
                    sets.append({
                        "set_id": next_set_id(), "exercise_id": exercise_id, "workout_id": workout_id,
                        "set_number": set_number, "is_warmup_set": False,
                        "input_1": str(int(meters)), "input_1_right": None, "input_2": None,
                        "rir": None, "rpe": None, "notes": "", "gym_id": gym_id, "schemaVersion": SCHEMA_VERSION,
                    })


# -- Exercise Notes (carry-forward, per exercise+workout) ---------------------
# A handful of one-off session notes scattered across the 8 weeks -- the
# kind of thing a user jots down for next time, not a note on every set of
# every workout. (week, day_index) picks which workout: day_index 0=Push,
# 1=Pull, 2=Legs, 3=Cardio, matching DAY_TYPES above.

EXERCISE_NOTE_ENTRIES = [
    (0, 0, "ex-bench-press", "Left shoulder felt tight on the last set. Stretch more before next time."),
    (1, 0, "ex-bench-press", "Much better after stretching. Grip width felt right."),
    (0, 2, "ex-squat", "Depth was inconsistent on set 3 -- filmed it, need to slow the descent."),
    (2, 2, "ex-squat", "Depth fixed. Knees still caving slightly under the heavier sets."),
    (1, 1, "ex-deadlift", "Bar drifted forward off the floor. Focus on pulling the slack out first."),
    (3, 1, "ex-deadlift", "Straps for the last set -- grip gave out before legs did."),
    (2, 1, "ex-pullup", "Added a slow 3-count negative on the last set, brutal but worth it."),
    (4, 3, "ex-treadmill-run", "Legs were heavy from leg day the day before. Consider swapping the order."),
    (3, 2, "ex-walking-lunge", "Home gym ceiling is too low to press the dumbbells overhead first -- just curl them up instead."),
    (5, 0, "ex-overhead-press", "New gym's bar is thicker, harder to grip. Chalk next time."),
    (4, 0, "ex-incline-db-press", "Bench angle at this gym is steeper than PowerHouse -- felt more front delt, less upper chest."),
    (6, 2, "ex-rdl", "Really felt the stretch in the hamstrings this time, good mind-muscle connection."),
    (7, 1, "ex-barbell-row", "Elbows flaring out again on the last set. Cue: elbows in toward the hips."),
    (6, 3, "ex-plank", "Held a clean 90s with no hip sag. Ready to start adding weight."),
    (7, 0, "ex-bench-press", "New PR pace -- if next session goes well, try for a true 1RM test."),
]

exercise_notes = []
for week, day_index, exercise_id, text in EXERCISE_NOTE_ENTRIES:
    workout_id = f"wk-{week:02d}-{day_index}"
    exercise_notes.append({
        "id": f"note-{workout_id}-{exercise_id}",
        "exercise_id": exercise_id,
        "workout_id": workout_id,
        "text": text,
        "schemaVersion": SCHEMA_VERSION,
    })


# -- Personal Records ---------------------------------------------------------
# The app now keeps every PR ever marked (append-only history), not just the
# single current best per exercise+gym -- so this reflects that: a new PR
# entry is emitted every time the top working set for a pair actually beats
# its running best, walked in chronological order. A plateau/regression
# week (progression has some noise) correctly produces no new PR, same as
# a real lifter wouldn't mark one every single session.

def top_value(s, ex):
    if ex["kind"] == "per_side":
        return (float(s["input_2"] or 0), (int(s["input_1"]) + int(s["input_1_right"])) / 2)
    if s["input_2"] is not None:
        return (float(s["input_2"]), int(s["input_1"]))
    return (int(s["input_1"]), 0)


workout_by_id = {w["id"]: w for w in workouts}

# (exercise_id, gym_id) -> [(date, workout_id, [working sets]), ...]
pair_sessions = {}
for s in sets:
    if s["is_warmup_set"]:
        continue
    key = (s["exercise_id"], s["gym_id"], s["workout_id"])
    pair_sessions.setdefault(key, []).append(s)

by_pair = {}
for (exercise_id, gym_id, workout_id), working_sets in pair_sessions.items():
    by_pair.setdefault((exercise_id, gym_id), []).append(
        (workout_by_id[workout_id]["date"], workout_id, working_sets)
    )

personal_records = []
for (exercise_id, gym_id), sessions in by_pair.items():
    ex = BY_ID[exercise_id]
    sessions.sort(key=lambda entry: entry[0])  # chronological, oldest first

    best_value = None
    for date, workout_id, working_sets in sessions:
        top = max(top_value(s, ex) for s in working_sets)
        if best_value is not None and top <= best_value:
            continue
        best_value = top
        personal_records.append({
            "id": f"pr-{workout_id}-{exercise_id}",
            "exercise_id": exercise_id,
            "gym_id": gym_id,
            "date": date,
            "sets": [
                {
                    "set_number": s["set_number"],
                    "is_warmup_set": s["is_warmup_set"],
                    "input_1": s["input_1"],
                    "input_1_right": s["input_1_right"],
                    "input_2": s["input_2"],
                    "rir": s["rir"],
                    "rpe": s["rpe"],
                }
                for s in working_sets
            ],
            "schemaVersion": SCHEMA_VERSION,
        })


# -- Write files --------------------------------------------------------------

with open("exercises.json", "w", encoding="utf-8") as f:
    json.dump(export_payload("exercises", exercises), f, indent=2)

with open("gyms.json", "w", encoding="utf-8") as f:
    json.dump(export_payload("gyms", gyms), f, indent=2)

with open("workouts.json", "w", encoding="utf-8") as f:
    json.dump(export_payload("workouts", workouts), f, indent=2)

with open("sets.json", "w", encoding="utf-8") as f:
    json.dump(export_payload("sets", sets), f, indent=2)

with open("personalRecords.json", "w", encoding="utf-8") as f:
    json.dump(export_payload("personalRecords", personal_records), f, indent=2)

with open("exerciseNotes.json", "w", encoding="utf-8") as f:
    json.dump(export_payload("exerciseNotes", exercise_notes), f, indent=2)

print(f"exercises: {len(exercises)} ({sum(1 for e in exercises if e['notes'])} with a global note)")
print(f"gyms: {len(gyms)}")
print(f"workouts: {len(workouts)}")
print(f"sets: {len(sets)}")
print(f"personalRecords: {len(personal_records)}")
print(f"exerciseNotes: {len(exercise_notes)}")
