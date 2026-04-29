#!/usr/bin/env python3
"""
Normalizes OTel collector debug output to single-line format.

Input (multi-line):
    info	ResourceMetrics #0
    Resource attributes:
         -> custom.attr: Str(electric.val)
         -> service.name: Str(electric)
    Metric #0
    Descriptor:
         -> Name: process.bin_memory.total
         -> DataType: Gauge
    Data point attributes:
         -> process_type: Str(A_memory_hog)
    Value: 12345

Output (single-line per event):
    ResourceMetrics custom.attr=electric.val service.name=electric
    Metric process.bin_memory.total DataType=Gauge process_type=A_memory_hog Value=12345

    Span shape_snapshot.execute_for_shape shape.query_reason=initial_snapshot
"""

import re
import sys

# Patterns
RESOURCE_BLOCK = re.compile(r'Resource(Metrics|Logs|Spans) #\d+')
SCOPE_BLOCK = re.compile(r'Scope(Metrics|Logs|Spans) #\d+')
METRIC = re.compile(r'Metric #\d+')
LOG_RECORD = re.compile(r'LogRecord #\d+')
SPAN = re.compile(r'Span #\d+')
ATTR = re.compile(r'^\s*->\s*([^:]+):\s*(?:Str\(([^)]*)\)|Int\(([^)]*)\)|Double\(([^)]*)\)|Bool\(([^)]*)\)|(.+))$')
NAME = re.compile(r'^\s*->\s*Name:\s*(.+)$')
SPAN_NAME = re.compile(r'^\s*Name\s*:\s*(.+)$')
VALUE = re.compile(r'^Value:\s*(.+)$')


def flush_event(event_type, name, attrs):
    """Output a single-line event."""
    if not event_type:
        return
    parts = [event_type]
    if name:
        parts.append(name)
    for k, v in attrs:
        parts.append(f"{k}={v}")
    print(" ".join(parts), flush=True)


def main():
    resource_attrs = []
    event_type = None
    event_name = None
    event_attrs = []
    in_resource_attrs = False
    in_data_point_attrs = False
    in_descriptor = False

    for line in sys.stdin:
        line = line.rstrip('\n')

        # New Resource* block (Metrics, Logs, or Spans)
        if RESOURCE_BLOCK.search(line):
            flush_event(event_type, event_name, resource_attrs + event_attrs)
            event_type = None
            event_name = None
            event_attrs = []
            resource_attrs = []
            in_resource_attrs = False
            in_data_point_attrs = False
            in_descriptor = False
            continue

        # Track attribute sections
        if 'Resource attributes:' in line:
            in_resource_attrs = True
            in_data_point_attrs = False
            in_descriptor = False
            continue

        if 'Data point attributes:' in line or 'Attributes:' in line:
            in_data_point_attrs = True
            in_resource_attrs = False
            in_descriptor = False
            continue

        if 'Descriptor:' in line:
            in_descriptor = True
            in_resource_attrs = False
            in_data_point_attrs = False
            continue

        if SCOPE_BLOCK.search(line):
            in_resource_attrs = False
            in_data_point_attrs = False
            in_descriptor = False
            continue

        # New Metric
        if METRIC.search(line):
            flush_event(event_type, event_name, resource_attrs + event_attrs)
            event_type = "Metric"
            event_name = None
            event_attrs = []
            in_descriptor = False
            in_data_point_attrs = False
            continue

        # New Span
        if SPAN.search(line):
            flush_event(event_type, event_name, resource_attrs + event_attrs)
            event_type = "Span"
            event_name = None
            event_attrs = []
            in_descriptor = False
            in_data_point_attrs = False
            continue

        # New LogRecord
        if LOG_RECORD.search(line):
            flush_event(event_type, event_name, resource_attrs + event_attrs)
            event_type = "LogRecord"
            event_name = None
            event_attrs = []
            in_descriptor = False
            in_data_point_attrs = False
            continue

        # Parse Name in descriptor
        if in_descriptor:
            m = NAME.match(line)
            if m:
                event_name = m.group(1).strip()
                continue

        # Parse Span name (different format)
        if event_type == "Span" and not event_name:
            m = SPAN_NAME.match(line)
            if m:
                event_name = m.group(1).strip()
                continue

        # Parse attributes
        m = ATTR.match(line)
        if m:
            key = m.group(1).strip()
            # Get the first non-None value group
            val = m.group(2) or m.group(3) or m.group(4) or m.group(5) or m.group(6) or ""
            val = val.strip()

            if in_resource_attrs:
                resource_attrs.append((key, val))
            elif in_data_point_attrs or event_type:
                event_attrs.append((key, val))
            continue

        # Parse Value
        m = VALUE.match(line)
        if m and event_type:
            event_attrs.append(("Value", m.group(1).strip()))
            continue

    # Flush final event
    flush_event(event_type, event_name, resource_attrs + event_attrs)


if __name__ == "__main__":
    main()
