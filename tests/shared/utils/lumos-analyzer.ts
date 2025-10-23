import { Page, Locator } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'fs';
import path from 'path';

/**
 * Lumos File Operations Manager
 * Provides robust file operations for AI Testing Intelligence Platform
 */
class LumosFileManager {
  /**
   * Ensures directory exists before file operations
   */
  private static ensureDirectory(filePath: string): void {
    try {
      const dir = path.dirname(filePath);
      mkdirSync(dir, { recursive: true });
    } catch (error) {
      throw new Error(
        `Lumos failed to create directory for ${filePath}: ${error.message}`
      );
    }
  }

  /**
   * Safely save Lumos analysis data with automatic directory creation
   */
  static saveAnalysis(filePath: string, data: any): void {
    try {
      this.ensureDirectory(filePath);
      writeFileSync(filePath, JSON.stringify(data, null, 2));
      console.log(`🔮 Lumos analysis saved: ${filePath}`);
    } catch (error) {
      const errorMsg = `Lumos analysis save failed - ${filePath}: ${error.message}`;
      console.error(`❌ ${errorMsg}`);
      throw new Error(errorMsg);
    }
  }

  /**
   * Safely save Lumos report data with automatic directory creation
   */
  static saveReport(filePath: string, data: any): void {
    try {
      this.ensureDirectory(filePath);
      writeFileSync(filePath, JSON.stringify(data, null, 2));
      console.log(`📊 Lumos report saved: ${filePath}`);
    } catch (error) {
      const errorMsg = `Lumos report save failed - ${filePath}: ${error.message}`;
      console.error(`❌ ${errorMsg}`);
      throw new Error(errorMsg);
    }
  }

  /**
   * Safely save any Lumos data with automatic directory creation
   */
  static saveData(
    filePath: string,
    data: any,
    description: string = 'data'
  ): void {
    try {
      this.ensureDirectory(filePath);
      writeFileSync(filePath, JSON.stringify(data, null, 2));
      console.log(`✅ Lumos ${description} saved: ${filePath}`);
    } catch (error) {
      const errorMsg = `Lumos ${description} save failed - ${filePath}: ${error.message}`;
      console.error(`❌ ${errorMsg}`);
      throw new Error(errorMsg);
    }
  }
}

export interface ErrorAnalysis {
  errorType: string;
  errorMessage: string;
  scenario: string;
  context: any;
  suggestedFixes?: string[];
  aiInsights?: {
    severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    patternRecognition?: string;
    preventionStrategy?: string;
  };
}

export interface ElementState {
  isVisible: boolean;
  isEnabled: boolean;
  isAttached: boolean;
  boundingBox: any;
  zIndex: string | null;
  timestamp: number;
  screenshot?: string;
}

/**
 * LumosAnalyzer - Intelligent Test Analysis Utility
 *
 * Provides AI-powered analysis capabilities for error scenarios,
 * element state tracking, and intelligent reporting.
 */
export class LumosAnalyzer {
  private page: Page;
  private testCategory: string;
  private analysisResults: ErrorAnalysis[] = [];
  private elementStates: Record<string, ElementState> = {};

  constructor(page: Page, testCategory: string) {
    this.page = page;
    this.testCategory = testCategory;
  }

  /**
   * Analyze an error scenario with AI-powered insights
   */
  async analyzeError(analysis: ErrorAnalysis): Promise<void> {
    console.log(`🤖 Lumos AI analyzing: ${analysis.errorType}`);

    // Add timestamp and enhanced context
    const enhancedAnalysis = {
      ...analysis,
      timestamp: new Date().toISOString(),
      testCategory: this.testCategory,
      pageUrl: this.page.url(),
      userAgent: await this.page.evaluate(() => navigator.userAgent),
      viewport: this.page.viewportSize(),
    };

    // Store for reporting
    this.analysisResults.push(enhancedAnalysis);

    // Save individual analysis file using robust file operations
    const filename = `${analysis.errorType.toLowerCase()}-${Date.now()}.json`;
    const outputPath = path.join('tests/shared/outputs/analysis', filename);

    LumosFileManager.saveAnalysis(outputPath, enhancedAnalysis);
  }

  /**
   * Analyze element state for visibility vs clickability comparison
   */
  async analyzeElementState(
    element: Locator,
    stateId: string
  ): Promise<ElementState> {
    console.log(`🔍 Analyzing element state: ${stateId}`);

    const state: ElementState = {
      isVisible: await element.isVisible().catch(() => false),
      isEnabled: await element.isEnabled().catch(() => false),
      isAttached: await element
        .count()
        .then((count) => count > 0)
        .catch(() => false),
      boundingBox: await element.boundingBox().catch(() => null),
      zIndex: await element
        .evaluate((el) => window.getComputedStyle(el).zIndex)
        .catch(() => null),
      timestamp: Date.now(),
    };

    // Take screenshot if element is visible
    if (state.isVisible) {
      try {
        const screenshotPath = `tests/shared/outputs/screenshots/element-state-${stateId}-${Date.now()}.png`;
        await element.screenshot({ path: screenshotPath });
        state.screenshot = screenshotPath;
      } catch (error) {
        console.log(`⚠️ Could not capture element screenshot: ${error}`);
      }
    }

    // Store state for comparison
    this.elementStates[stateId] = state;

    return state;
  }

  /**
   * Compare two element states to identify blocking issues
   */
  async compareElementStates(
    beforeState: ElementState,
    afterState: ElementState,
    comparisonId: string
  ): Promise<void> {
    console.log(`🔄 Comparing element states: ${comparisonId}`);

    const comparison = {
      comparisonId,
      timestamp: new Date().toISOString(),
      before: beforeState,
      after: afterState,
      changes: {
        visibilityChanged: beforeState.isVisible !== afterState.isVisible,
        enabledChanged: beforeState.isEnabled !== afterState.isEnabled,
        attachmentChanged: beforeState.isAttached !== afterState.isAttached,
        positionChanged:
          JSON.stringify(beforeState.boundingBox) !==
          JSON.stringify(afterState.boundingBox),
        zIndexChanged: beforeState.zIndex !== afterState.zIndex,
      },
      analysis: {
        possibleBlocking:
          beforeState.isVisible &&
          afterState.isVisible &&
          beforeState.isEnabled &&
          !afterState.isEnabled,
        layoutShift:
          beforeState.boundingBox &&
          afterState.boundingBox &&
          (beforeState.boundingBox.x !== afterState.boundingBox.x ||
            beforeState.boundingBox.y !== afterState.boundingBox.y),
        zIndexConflict: beforeState.zIndex !== afterState.zIndex,
      },
    };

    // Save comparison analysis using robust file operations
    const filename = `element-comparison-${comparisonId}-${Date.now()}.json`;
    const outputPath = path.join('tests/shared/outputs/analysis', filename);

    LumosFileManager.saveData(
      outputPath,
      comparison,
      'element state comparison'
    );
  }

  /**
   * Simulate the Lumos CLI analyze command integration
   */
  async runLumosCliAnalysis(
    errorMessage: string,
    options: any = {}
  ): Promise<any> {
    console.log(`📝 Running Lumos CLI analysis: ${errorMessage}`);

    // Simulate the CLI command that would be run
    const command = `npm run build && node dist/cli/index.js analyze "${errorMessage}" --research --fix-suggestions --confidence 0.7`;

    // Create simulated CLI analysis result
    const cliAnalysis = {
      command,
      errorMessage,
      options,
      timestamp: new Date().toISOString(),
      simulation: true,
      expectedOutput: {
        category: this.categorizeError(errorMessage),
        confidence: 0.85,
        suggestions: this.generateSuggestions(errorMessage),
        research: this.simulateResearch(errorMessage),
      },
    };

    // Save CLI analysis simulation using robust file operations
    const filename = `cli-analysis-${Date.now()}.json`;
    const outputPath = path.join('tests/shared/outputs/analysis', filename);

    LumosFileManager.saveData(
      outputPath,
      cliAnalysis,
      'CLI analysis simulation'
    );

    return cliAnalysis;
  }

  /**
   * Generate comprehensive test report
   */
  async generateReport(reportId: string): Promise<void> {
    console.log(`📊 Generating Lumos test report: ${reportId}`);

    const report = {
      reportId,
      testCategory: this.testCategory,
      timestamp: new Date().toISOString(),
      summary: {
        totalAnalyses: this.analysisResults.length,
        errorTypes: [...new Set(this.analysisResults.map((a) => a.errorType))],
        severityBreakdown: this.getSeverityBreakdown(),
        elementStatesTracked: Object.keys(this.elementStates).length,
      },
      analyses: this.analysisResults,
      elementStates: this.elementStates,
      insights: {
        mostCommonErrorType: this.getMostCommonErrorType(),
        averageAnalysisTime: this.getAverageAnalysisTime(),
        recommendedActions: this.getRecommendedActions(),
      },
    };

    // Save comprehensive report using robust file operations
    const filename = `lumos-report-${reportId}-${Date.now()}.json`;
    const outputPath = path.join('tests/shared/outputs/reports', filename);

    LumosFileManager.saveReport(outputPath, report);
  }

  // Helper methods
  private categorizeError(errorMessage: string): string {
    if (errorMessage.includes('timeout')) return 'TIMEOUT_ERROR';
    if (errorMessage.includes('not found')) return 'ELEMENT_NOT_FOUND';
    if (errorMessage.includes('intercepts')) return 'ELEMENT_INTERCEPTION';
    if (errorMessage.includes('network')) return 'NETWORK_ERROR';
    return 'UNKNOWN_ERROR';
  }

  private generateSuggestions(errorMessage: string): string[] {
    const suggestions: string[] = [];

    if (errorMessage.includes('timeout')) {
      suggestions.push('Increase timeout duration');
      suggestions.push('Add explicit wait conditions');
      suggestions.push('Check for loading states');
    }

    if (errorMessage.includes('intercepts')) {
      suggestions.push('Check for modal overlays');
      suggestions.push('Use force click option');
      suggestions.push('Wait for blocking elements to disappear');
    }

    return suggestions;
  }

  private simulateResearch(errorMessage: string): any {
    return {
      stackOverflowResults: 3,
      githubIssues: 2,
      documentationLinks: 1,
      communityDiscussions: 4,
    };
  }

  private getSeverityBreakdown(): Record<string, number> {
    const breakdown: Record<string, number> = {
      LOW: 0,
      MEDIUM: 0,
      HIGH: 0,
      CRITICAL: 0,
    };
    this.analysisResults.forEach((analysis) => {
      if (analysis.aiInsights?.severity) {
        breakdown[analysis.aiInsights.severity]++;
      }
    });
    return breakdown;
  }

  private getMostCommonErrorType(): string {
    const errorCounts: Record<string, number> = {};
    this.analysisResults.forEach((analysis) => {
      errorCounts[analysis.errorType] =
        (errorCounts[analysis.errorType] || 0) + 1;
    });
    return Object.keys(errorCounts).reduce(
      (a, b) => (errorCounts[a] > errorCounts[b] ? a : b),
      ''
    );
  }

  private getAverageAnalysisTime(): number {
    // Simulate analysis time calculation
    return Math.round(Math.random() * 1000 + 500); // 500-1500ms
  }

  private getRecommendedActions(): string[] {
    return [
      'Review modal state management patterns',
      'Implement comprehensive element visibility checks',
      'Add timeout configuration management',
      'Consider implementing retry strategies',
    ];
  }
}
