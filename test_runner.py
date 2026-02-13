#!/usr/bin/env python3
"""Test runner for program output verification"""

import subprocess
import sys
from pathlib import Path

def run_program_and_capture_output(program_path):
    """Execute program and return stdout as list of lines"""
    try:
        result = subprocess.run(
            [program_path],
            capture_output=True,
            text=True,
            timeout=5
        )
        return result.stdout.strip().split('\n')
    except FileNotFoundError:
        print(f"Error: Program '{program_path}' not found")
        return []
    except subprocess.TimeoutExpired:
        print(f"Error: Program '{program_path}' timed out")
        return []
    except Exception as e:
        print(f"Error running program: {e}")
        return []

def load_expected_output():
    """Load expected output from file"""
    try:
        with open('expected_output.txt', 'r') as f:
            return [line.strip() for line in f.readlines()]
    except FileNotFoundError:
        print("Error: expected_output.txt not found")
        return []

def test_sequential_numbers():
    """Main test function"""
    
    # Check for program to test
    program_path = './program'
    if not Path(program_path).exists():
        program_path = './program.exe'
    
    if not Path(program_path).exists():
        print("Error: No program found to test. Expected './program' or './program.exe'")
        return False
    
    # Load expected output
    expected = load_expected_output()
    if not expected:
        return False
    
    print(f"Testing program: {program_path}")
    print(f"Expected output: {expected}")
    
    # Run program
    actual = run_program_and_capture_output(program_path)
    if not actual:
        return False
    
    print(f"Actual output: {actual}")
    
    # Test 1: Check if output has exactly 5 lines
    if len(actual) != 5:
        print(f"FAIL: Expected 5 lines, got {len(actual)} lines")
        return False
    
    print("PASS: Output has 5 lines")
    
    # Test 2: Check if numbers are 1 through 5
    for i, (actual_line, expected_line) in enumerate(zip(actual, expected), 1):
        if actual_line != expected_line:
            print(f"FAIL: Line {i}: Expected '{expected_line}', got '{actual_line}'")
            return False
    
    print("PASS: All numbers match expected sequence")
    
    # Test 3: Check if numbers are sequential
    try:
        numbers = [int(line) for line in actual]
        for i in range(len(numbers) - 1):
            if numbers[i + 1] - numbers[i] != 1:
                print(f"FAIL: Numbers not sequential at position {i+1}")
                return False
        print("PASS: Numbers are sequential")
    except ValueError:
        print("FAIL: Output contains non-numeric values")
        return False
    
    # Test 4: Check complete range
    if numbers[0] != 1 or numbers[-1] != 5:
        print(f"FAIL: Range should be 1-5, got {numbers[0]}-{numbers[-1]}")
        return False
    
    print("PASS: Complete range 1-5")
    
    print("\n✅ All tests passed! Program output is correct.")
    return True

def run_edge_case_tests():
    """Additional edge case tests"""
    print("\n--- Running edge case tests ---")
    
    # Test for extra whitespace
    test_cases = [
        (["1", "2", "3", "4", "5"], "No extra whitespace", True),
        (["1", "2", " 3", "4", "5"], "Leading space", False),
        (["1", "2", "3 ", "4", "5"], "Trailing space", False),
        (["1", "", "3", "4", "5"], "Empty line", False),
        (["1", "2", "3", "4"], "Missing number", False),
        (["1", "2", "3", "4", "5", "6"], "Extra number", False),
        (["1", "2.0", "3", "4", "5"], "Decimal number", False),
        (["one", "two", "three", "four", "five"], "Text instead of numbers", False)
    ]
    
    for test_output, description, should_pass in test_cases:
        is_correct = test_output == ["1", "2", "3", "4", "5"]
        status = "✓" if (is_correct == should_pass) else "✗"
        print(f"{status} {description}: {test_output}")
    
    return True

if __name__ == "__main__":
    print("=== Program Output Tester ===")
    
    # Run main tests
    if test_sequential_numbers():
        # Run edge cases
        run_edge_case_tests()
        sys.exit(0)
    else:
        print("\n❌ Tests failed!")
        sys.exit(1)