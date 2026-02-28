"""Code generator for creating code frameworks from requirements.

This module provides tools to generate code scaffolding, boilerplate,
and implementations based on parsed requirements.
"""

from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from nanobot.dev.requirement_parser import ParsedRequirements


class Language(str, Enum):
    """Supported programming languages."""
    PYTHON = "python"
    TYPESCRIPT = "typescript"
    JAVASCRIPT = "javascript"
    GO = "go"
    RUST = "rust"
    JAVA = "java"
    CPP = "cpp"


class CodeQuality(str, Enum):
    """Code quality levels."""
    POOR = "poor"
    FAIR = "fair"
    GOOD = "good"
    EXCELLENT = "excellent"


@dataclass
class GeneratedFile:
    """A generated code file."""
    path: str
    content: str
    language: Language


@dataclass
class GenerationResult:
    """Result of code generation."""
    files: list[GeneratedFile] = field(default_factory=list)
    quality: CodeQuality = CodeQuality.GOOD
    success_rate: float = 1.0
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


class CodeGenerationConfig(BaseModel):
    """Configuration for code generation."""

    model_config = ConfigDict(arbitrary_types_allowed=True)

    language: Language = Field(default=Language.PYTHON, description="Target programming language")
    output_dir: str = Field(default="./generated", description="Output directory")
    include_tests: bool = Field(default=True, description="Include test files")
    include_docs: bool = Field(default=True, description="Include documentation")
    style_guide: str | None = Field(default=None, description="Style guide to follow")
    max_file_size: int = Field(default=10000, description="Maximum file size in characters")


class CodeGenerator:
    """
    Code generator for creating code frameworks from requirements.

    Supports multiple programming languages and generates:
    - Project structure
    - Boilerplate code
    - Tests
    - Documentation
    - Configuration files
    """

    # Language-specific templates
    TEMPLATES = {
        Language.PYTHON: {
            "main": '''"""Main module for {project_name}."""

from typing import Any


def main() -> int:
    """Main entry point."""
    print("Hello from {project_name}!")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
''',
            "test": '''"""Tests for {module_name}."""

import pytest


def test_{module_name}_basic():
    """Test basic functionality."""
    assert True


@pytest.mark.asyncio
async def test_{module_name}_async():
    """Test async functionality."""
    assert True
''',
            "pyproject": '''[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[project]
name = "{package_name}"
version = "0.1.0"
description = "{description}"
authors = [
    {{name = "Author", email = "author@example.com"}},
]
readme = "README.md"
requires-python = ">=3.11"
dependencies = []

[tool.ruff]
line-length = 100
target-version = "py311"

[tool.pytest.ini_options]
asyncio_mode = "auto"
''',
            "readme": '''# {project_name}

{description}

## Installation

```bash
pip install {package_name}
```

## Usage

```python
from {package_name} import main

main()
```

## Development

```bash
# Install with dev dependencies
pip install -e ".[dev]"

# Run tests
pytest

# Lint
ruff check .
```

## License

MIT
''',
        },
        Language.TYPESCRIPT: {
            "main": '''/**
 * Main entry point for {project_name}
 */

export function main(): number {{
    console.log("Hello from {project_name}!");
    return 0;
}}

if (require.main === module) {{
    main();
}}
''',
            "test": '''/**
 * Tests for {module_name}
 */

import {{ describe, it, expect }} from "vitest";

describe("{module_name}", () => {{
    it("should work", () => {{
        expect(true).toBe(true);
    }});
}});
''',
            "package": '''{{
  "name": "{package_name}",
  "version": "0.1.0",
  "description": "{description}",
  "type": "module",
  "main": "dist/index.js",
  "scripts": {{
    "dev": "tsup --watch",
    "build": "tsup",
    "test": "vitest",
    "lint": "eslint ."
  }},
  "dependencies": {{}},
  "devDependencies": {{
    "@types/node": "^20.0.0",
    "typescript": "^5.0.0",
    "vitest": "^1.0.0",
    "tsup": "^8.0.0"
  }}
}}
''',
            "tsconfig": '''{{
  "compilerOptions": {{
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  }},
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}}
''',
            "readme": '''# {project_name}

{description}

## Installation

```bash
npm install {package_name}
```

## Usage

```typescript
import {{ main }} from '{package_name}';

main();
```

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Build
npm build
```

## License

MIT
''',
        },
    }

    def __init__(self, provider: Any = None):
        """
        Initialize the code generator.

        Args:
            provider: LLM provider for intelligent code generation.
                     If None, uses template-based generation only.
        """
        self.provider = provider

    def generate(
        self,
        requirements: ParsedRequirements,
        config: CodeGenerationConfig | None = None,
    ) -> GenerationResult:
        """
        Generate code from parsed requirements.

        Args:
            requirements: Parsed requirements.
            config: Generation configuration.

        Returns:
            GenerationResult with generated files and metadata.
        """
        if config is None:
            config = CodeGenerationConfig()

        result = GenerationResult()

        try:
            if self.provider:
                return self._generate_with_llm(requirements, config)
            return self._generate_with_templates(requirements, config)
        except Exception as e:
            result.errors.append(f"Generation failed: {e}")
            result.success_rate = 0.0
            return result

    def _generate_with_llm(
        self,
        requirements: ParsedRequirements,
        config: CodeGenerationConfig,
    ) -> GenerationResult:
        """Generate code using LLM for intelligent generation."""
        prompt = self._build_generation_prompt(requirements, config)

        try:
            response = self._call_llm(prompt)
            return self._parse_llm_response(response, config)
        except Exception:
            # Fallback to templates
            return self._generate_with_templates(requirements, config)

    def _build_generation_prompt(
        self,
        requirements: ParsedRequirements,
        config: CodeGenerationConfig,
    ) -> str:
        """Build the prompt for LLM code generation."""
        return f"""You are a code generator. Generate code for the following requirements.

Requirements:
Summary: {requirements.summary}
Technologies: {', '.join(requirements.technologies)}
Deliverables: {[d.name for d in requirements.deliverables]}
Constraints: {requirements.constraints}

Generate production-ready code in {config.language.value} with:
1. Project structure
2. Main implementation files
3. Test files
4. Configuration files
5. Documentation

Return a JSON with this structure:
{{
    "files": [
        {{"path": "relative/path/to/file.ext", "content": "file content", "language": "python"}}
    ],
    "quality": "poor|fair|good|excellent",
    "warnings": ["any warnings about the generated code"]
}}

Guidelines:
- Follow best practices for {config.language.value}
- Include error handling
- Add type hints where applicable
- Write clean, readable code
- Include helpful comments

Return ONLY valid JSON, no other text."""

    def _call_llm(self, prompt: str) -> str:
        """Call the LLM provider."""
        import asyncio

        async def _call():
            messages = [{"role": "user", "content": prompt}]
            response = await self.provider.chat(
                messages=messages,
                model=None,
                max_tokens=8192,
                temperature=0.3,
            )
            return response.content or ""

        return asyncio.run(_call())

    def _parse_llm_response(
        self,
        response: str,
        config: CodeGenerationConfig,
    ) -> GenerationResult:
        """Parse LLM response into GenerationResult."""
        import json
        import re

        result = GenerationResult()

        try:
            json_match = re.search(r'\{[\s\S]*\}', response)
            if not json_match:
                raise ValueError("No JSON found")

            data = json.loads(json_match.group(0))

            for file_data in data.get("files", []):
                result.files.append(GeneratedFile(
                    path=file_data["path"],
                    content=file_data["content"],
                    language=Language(file_data.get("language", config.language.value)),
                ))

            result.quality = CodeQuality(data.get("quality", "good"))
            result.warnings = data.get("warnings", [])

            # Calculate success rate
            total = len(result.files)
            if total > 0:
                successful = sum(1 for f in result.files if f.content.strip())
                result.success_rate = successful / total

        except Exception as e:
            result.errors.append(f"Failed to parse LLM response: {e}")
            result.success_rate = 0.0

        return result

    def _generate_with_templates(
        self,
        requirements: ParsedRequirements,
        config: CodeGenerationConfig,
    ) -> GenerationResult:
        """Generate code using template-based generation."""
        result = GenerationResult()
        language = config.language

        if language not in self.TEMPLATES:
            result.errors.append(f"Language {language.value} not supported for template generation")
            result.success_rate = 0.0
            return result

        templates = self.TEMPLATES[language]

        # Derive project info from requirements
        project_name = self._derive_project_name(requirements)
        package_name = project_name.lower().replace(" ", "_").replace("-", "_")
        description = requirements.summary[:200]

        # Generate main file
        main_content = templates["main"].format(
            project_name=project_name,
            package_name=package_name,
            description=description,
        )

        main_ext = "py" if language == Language.PYTHON else "ts"
        main_path = f"src/main.{main_ext}" if language == Language.TYPESCRIPT else f"src/{package_name}/__init__.py"

        result.files.append(GeneratedFile(
            path=main_path,
            content=main_content,
            language=language,
        ))

        # Generate tests
        if config.include_tests and "test" in templates:
            test_content = templates["test"].format(
                project_name=project_name,
                package_name=package_name,
                module_name=package_name.replace("_", ""),
            )
            test_path = f"tests/test_{package_name}.{main_ext}"
            result.files.append(GeneratedFile(
                path=test_path,
                content=test_content,
                language=language,
            ))

        # Generate configuration
        config_key = "pyproject" if language == Language.PYTHON else "package"
        if config_key in templates:
            config_content = templates[config_key].format(
                project_name=project_name,
                package_name=package_name,
                description=description,
            )
            config_path = "pyproject.toml" if language == Language.PYTHON else "package.json"
            result.files.append(GeneratedFile(
                path=config_path,
                content=config_content,
                language=language,
            ))

        # Generate tsconfig for TypeScript
        if language == Language.TYPESCRIPT and "tsconfig" in templates:
            tsconfig_content = templates["tsconfig"].format(
                project_name=project_name,
                package_name=package_name,
                description=description,
            )
            result.files.append(GeneratedFile(
                path="tsconfig.json",
                content=tsconfig_content,
                language=language,
            ))

        # Generate README
        if config.include_docs and "readme" in templates:
            readme_content = templates["readme"].format(
                project_name=project_name,
                package_name=package_name,
                description=description,
            )
            result.files.append(GeneratedFile(
                path="README.md",
                content=readme_content,
                language=language,
            ))

        # All templates should succeed
        result.success_rate = 1.0
        result.quality = CodeQuality.GOOD

        return result

    def _derive_project_name(self, requirements: ParsedRequirements) -> str:
        """Derive a project name from requirements."""
        if requirements.deliverables:
            return requirements.deliverables[0].name

        # Extract from technologies
        if requirements.technologies:
            tech = requirements.technologies[0]
            return f"{tech.title()} Project"

        # Use summary
        words = requirements.summary.split()[:3]
        return " ".join(w.title() for w in words if w.isalpha())

    def write_files(
        self,
        result: GenerationResult,
        output_dir: str | None = None,
    ) -> list[str]:
        """
        Write generated files to disk.

        Args:
            result: Generation result with files.
            output_dir: Output directory (overrides config).

        Returns:
            List of written file paths.
        """
        if output_dir is None:
            output_dir = "."

        written_paths = []

        for file in result.files:
            file_path = Path(output_dir) / file.path
            file_path.parent.mkdir(parents=True, exist_ok=True)

            try:
                file_path.write_text(file.content, encoding="utf-8")
                written_paths.append(str(file_path))
            except Exception as e:
                result.errors.append(f"Failed to write {file.path}: {e}")

        return written_paths

    def review_code(self, result: GenerationResult) -> dict[str, Any]:
        """
        Review generated code for quality issues.

        Args:
            result: Generation result to review.

        Returns:
            Review results with issues and suggestions.
        """
        review = {
            "total_files": len(result.files),
            "issues": [],
            "suggestions": [],
            "score": 0.0,
        }

        for file in result.files:
            # Check file size
            if len(file.content) > 10000:
                review["issues"].append(f"{file.path}: File too large (>10KB)")

            # Check for TODO comments
            if "TODO" in file.content or "FIXME" in file.content:
                review["suggestions"].append(f"{file.path}: Contains TODO/FIXME comments")

            # Check for empty files
            if not file.content.strip():
                review["issues"].append(f"{file.path}: Empty file")

            # Check for error handling (basic)
            if "try:" not in file.content and "except" not in file.content:
                if "def " in file.content or "function " in file.content:
                    review["suggestions"].append(f"{file.path}: Consider adding error handling")

        # Calculate score (0-1)
        if review["total_files"] > 0:
            issue_penalty = len(review["issues"]) / review["total_files"]
            review["score"] = max(0.0, 1.0 - issue_penalty)

        return review

    def estimate_success_rate(self, requirements: ParsedRequirements) -> float:
        """
        Estimate code generation success rate based on requirements.

        Args:
            requirements: Parsed requirements.

        Returns:
            Estimated success rate (0-1).
        """
        score = 0.5  # Base score

        # Higher confidence = higher success rate
        score += requirements.confidence * 0.3

        # More specific = higher success rate
        if len(requirements.ambiguities) == 0:
            score += 0.1
        else:
            score -= min(0.2, len(requirements.ambiguities) * 0.05)

        # More technologies = more complex
        if len(requirements.technologies) > 5:
            score -= 0.1

        # More deliverables = more complex
        if len(requirements.deliverables) > 10:
            score -= 0.1

        return max(0.0, min(1.0, score))
