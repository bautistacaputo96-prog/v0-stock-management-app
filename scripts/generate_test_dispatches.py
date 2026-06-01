import random
from datetime import datetime, timedelta
import json

# Generate 100 test dispatches with samples over the last 6 months
# This script will output SQL INSERT statements

# We'll need to get the actual IDs from the database first
# For now, I'll create a placeholder script that generates the data structure

dispatches = []
start_date = datetime.now() - timedelta(days=180)

# Sample numbers starting from 1000 to avoid conflicts
sample_number_start = 1000

for i in range(100):
    # Random date in the last 6 months
    random_days = random.randint(0, 180)
    dispatch_date = start_date + timedelta(days=random_days)
    
    # Random formula (H21 or H25)
    formula_code = random.choice(['H-21', 'H-25'])
    
    # Random quantity between 3 and 12 m3
    quantity_m3 = round(random.uniform(3.0, 12.0), 2)
    
    # Sample number
    sample_number = str(sample_number_start + i)
    
    # Generate 3 cylinder test results for this sample
    cylinders = []
    
    # Cylinder 1: 7 days test
    base_strength_7d = 21 if formula_code == 'H-21' else 25
    strength_7d = round(base_strength_7d * random.uniform(0.85, 1.05), 2)
    test_date_7d = dispatch_date + timedelta(days=7)
    dial_reading_7d = round(strength_7d * random.uniform(2.0, 2.5), 0)
    
    cylinders.append({
        'cylinder_number': 1,
        'test_age_days': 7,
        'dial_reading': dial_reading_7d,
        'strength_mpa': strength_7d,
        'test_date': test_date_7d.strftime('%Y-%m-%d'),
        'weight_kg': round(random.uniform(3.5, 4.0), 2)
    })
    
    # Cylinders 2 and 3: 28 days tests
    base_strength_28d = 21 if formula_code == 'H-21' else 25
    for cyl_num in [2, 3]:
        strength_28d = round(base_strength_28d * random.uniform(1.15, 1.35), 2)
        test_date_28d = dispatch_date + timedelta(days=28)
        dial_reading_28d = round(strength_28d * random.uniform(2.0, 2.5), 0)
        
        cylinders.append({
            'cylinder_number': cyl_num,
            'test_age_days': 28,
            'dial_reading': dial_reading_28d,
            'strength_mpa': strength_28d,
            'test_date': test_date_28d.strftime('%Y-%m-%d'),
            'weight_kg': round(random.uniform(3.5, 4.0), 2)
        })
    
    dispatches.append({
        'sample_number': sample_number,
        'dispatch_date': dispatch_date.strftime('%Y-%m-%d'),
        'formula_code': formula_code,
        'quantity_m3': quantity_m3,
        'sample_extracted': True,
        'cylinders': cylinders
    })

# Output as JSON for inspection
print(json.dumps(dispatches[:3], indent=2))
print(f"\nGenerated {len(dispatches)} dispatches with samples")
