"""
BenchExec is a framework for reliable benchmarking.
This file is part of BenchExec.

Copyright (C) 2007-2019  Dirk Beyer
All rights reserved.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
"""

import argparse
import benchexec.util as util
import benchexec.tools.template
import benchexec.result as result
import contextlib
import os
import sys
import threading


class Tool(benchexec.tools.template.BaseTool):
    """
    This is the tool info module for MetaVal.

    The official repository is:
    https://gitlab.com/sosy-lab/software/metaval

    Please report any issues to our issue tracker at:
    https://gitlab.com/sosy-lab/software/metaval/issues

    """

    TOOL_TO_PATH_MAP = {
        "cpachecker-metaval": "CPAchecker",
        "cpachecker": "CPAchecker-1.7-svn 29852-unix",
        "esbmc": "esbmc",
        "symbiotic": "symbiotic",
        "yogar-cbmc": "yogar-cbmc",
        "ultimateautomizer": "UAutomizer-linux",
    }
    REQUIRED_PATHS = list(TOOL_TO_PATH_MAP.values())

    def __init__(self):
        self.lock = threading.Lock()

    def executable(self):
        return util.find_executable("metaval.sh")

    def name(self):
        return "metaval"

    @contextlib.contextmanager
    def _in_tool_directory(self):
        """
        Context manager that sets the current working directory to the tool's directory
        and resets its afterward. The returned value is the previous working directory.
        """
        with self.lock:
            try:
                oldcwd = os.getcwd()
                os.chdir(os.path.join(oldcwd, self.TOOL_TO_PATH_MAP[self.verifierName]))
                yield oldcwd
            finally:
                os.chdir(oldcwd)

    def determine_result(self, returncode, returnsignal, output, isTimeout):
        if not hasattr(self, "wrappedTool"):
            return "METAVAL ERROR"

        with self._in_tool_directory():
            return self.wrappedTool.determine_result(
                returncode, returnsignal, output, isTimeout
            )

    def cmdline(self, executable, options, tasks, propertyfile=None, rlimits={}):
        parser = argparse.ArgumentParser(add_help=False, usage=argparse.SUPPRESS)
        parser.add_argument("--metavalWitness", required=True)
        parser.add_argument("--metaval", required=True)
        parser.add_argument("--metavalAdditionalPATH")
        parser.add_argument("--metavalWitnessType")
        (knownargs, options) = parser.parse_known_args(options)
        verifierName = knownargs.metaval.lower()
        witnessName = knownargs.metavalWitness
        additionalPathArgument = (
            ["--additionalPATH", knownargs.metavalAdditionalPATH]
            if knownargs.metavalAdditionalPATH
            else []
        )
        witnessTypeArgument = (
            ["--witnessType", knownargs.metavalWitnessType]
            if knownargs.metavalWitnessType
            else []
        )
        with self.lock:
            if not hasattr(self, "wrappedTool"):
                self.verifierName = verifierName
                self.wrappedTool = __import__(
                    "benchexec.tools." + verifierName, fromlist=["Tool"]
                ).Tool()
            else:
                if not verifierName == self.verifierName:
                    sys.exit("metaval is called with mixed wrapped tools")

        if hasattr(self, "wrappedTool"):
            with self._in_tool_directory() as oldcwd:
                wrappedOptions = self.wrappedTool.cmdline(
                    self.wrappedTool.executable(),
                    options,
                    [os.path.relpath(os.path.join(oldcwd, "output/ARG.c"))],
                    os.path.relpath(os.path.join(oldcwd, propertyfile)),
                    rlimits,
                )
            return (
                [
                    executable,
                    "--verifier",
                    self.TOOL_TO_PATH_MAP[verifierName],
                    "--witness",
                    witnessName,
                ]
                + additionalPathArgument
                + witnessTypeArgument
                + tasks
                + ["--"]
                + wrappedOptions
            )
        else:
            sys.exit("ERROR: Could not find wrapped tool")

    def version(self, executable):
        stdout = self._version_from_tool(executable, "--version")
        metavalVersion = stdout.splitlines()[0].strip()
        return metavalVersion