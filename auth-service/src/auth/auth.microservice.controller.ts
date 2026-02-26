import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { AuthService } from './auth.service';

// Message patterns are contracts between microservices
// Other services call these patterns over TCP

@Controller()
export class AuthMicroserviceController {
  constructor(private readonly authService: AuthService) {}

  /**
   * Called by: API Gateway, any service needing token validation
   * Pattern: auth.validate_token
   */
  @MessagePattern('auth.validate_token')
  async validateToken(@Payload() data: { token: string }) {
    return this.authService.validateToken(data.token);
  }

  /**
   * Called by: User Service, Order Service, etc.
   * Pattern: auth.get_user_from_token
   * Returns the decoded user payload if token is valid
   */
  @MessagePattern('auth.get_user_from_token')
  async getUserFromToken(@Payload() data: { token: string }) {
    const result = await this.authService.validateToken(data.token);
    if (!result.valid) return { error: 'Invalid or expired token' };
    return { user: result.payload };
  }
}